package main

import (
	"context"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"net/http"
	"text/template"
	"encoding/json"
	"unsafe"
	"errors"

	"github.com/spf13/pflag"
	"github.com/vmihailenco/msgpack/v5"
	//"github.com/tidwall/gjson"
	
	"go.elara.ws/go-lemmy"
	"go.elara.ws/go-lemmy/types"
	"go.elara.ws/logger/log"
)

type itemType uint8

const (
	comment itemType = iota
	post
)

type item struct {
	Type itemType
	ID   int
}

func (it itemType) String() string {
	switch it {
	case comment:
		return "comment"
	case post:
		return "post"
	default:
		return "<unknown>"
	}
}

type Submatches []string

func (sm Submatches) Item(i int) string {
	return sm[i]
}

type TmplContext struct {
	Matches []Submatches
	Type    itemType
}

func (tc TmplContext) Match(i, j int) string {
	return tc.Matches[i][j]
}

func main() {
	configPath := pflag.StringP("config", "c", "./lemmy-reply-bot.toml", "Path to the config file")
	dryRun := pflag.BoolP("dry-run", "D", false, "Don't actually send comments, just check for matches")
	pflag.Parse()

	ctx := context.Background()
	ctx, cancel := signal.NotifyContext(ctx, syscall.SIGINT, syscall.SIGTERM)
	defer cancel()

	err := loadConfig(*configPath)
	if err != nil {
		log.Fatal("Error loading config file").Err(err).Send()
	}

	c, err := lemmy.NewWebSocket(cfg.Lemmy.InstanceURL)
	if err != nil {
		log.Fatal("Error creating new Lemmy API client: " + cfg.Lemmy.InstanceURL).Err(err).Send()
	}

	err = c.ClientLogin(ctx, types.Login{
		UsernameOrEmail: cfg.Lemmy.Account.UserOrEmail,
		Password:        cfg.Lemmy.Account.Password,
	})
	if err != nil {
		log.Fatal("Error logging in to Lemmy instance").Err(err).Send()
	}

	log.Info("Successfully logged in to Lemmy instance").Send()

	joinAll(c)

	c.OnReconnect(func(c *lemmy.WSClient) {
		joinAll(c)
		log.Info("Successfully reconnected to WebSocket").Send()
	})

	replyCh := make(chan replyJob, 200)

	if !*dryRun {
		go commentReplyWorker(ctx, c, replyCh)
	}

	commentWorker(ctx, c, replyCh)
}

func commentWorker(ctx context.Context, c *lemmy.WSClient, replyCh chan<- replyJob) {
	repliedIDs := map[item]struct{}{}

	repliedStore, err := os.Open("replied.bin")
	if err == nil {
		err = msgpack.NewDecoder(repliedStore).Decode(&repliedIDs)
		if err != nil {
			log.Warn("Error decoding reply store").Err(err).Send()
		}
		repliedStore.Close()
	}

	for {
		select {
		case res := <-c.Responses():
			/* if res.IsOneOf(types.UserOperationCRUDCreateComment, types.UserOperationCRUDEditComment) {
				// Analysing COMMENTS
				// TODO: Now ignoring them
				// Check https://gitea.elara.ws/Elara6331/lemmy-reply-bot.git to reimplement
			} else */
			if res.IsOneOf(types.UserOperationCRUDCreatePost, types.UserOperationCRUDEditPost) {
				// Analysing POSTS

				var pr types.PostResponse
				err = lemmy.DecodeResponse(res.Data, &pr)
				if err != nil {
					log.Warn("Error while trying to decode comment").Err(err).Send()
					continue
				}

				if !pr.PostView.Community.Local {
					continue
				}

				if _, ok := repliedIDs[item{post, pr.PostView.Post.ID}]; ok {
					continue
				}

				body := pr.PostView.Post.URL.ValueOr("") // + "\n\n" + pr.PostView.Post.Body.ValueOr("")
				re := compiledRegexes[cfg.Regexp.Youtube]
				if !re.MatchString(body) {
					continue
				}

				log.Info("Matched post body").
					Int("post-id", pr.PostView.Post.ID).
					Send()

				// job := replyJob{PostID: pr.PostView.Post.ID}


				// Check that https://api.tournesol.app/polls/videos/entities/yt:<vid> returns 200
				for _, vid := range re.FindAllStringSubmatch(body, -1) {
					video := getJson(vid[0])
					if video == nil {
						continue
					}
					v := *video
					log.Warn(v.Metadata.Channel + ": " + v.Metadata.Name)
				}

				continue // TODO
				/*
				job.Content, err = executeTmpl(compiledTmpls[reply.Regex], TmplContext{
					Matches: matches,
					Type:    post,
				})
				if err != nil {
					log.Warn("Error while executing template").Err(err).Send()
					continue
				}

				replyCh <- job

				repliedIDs[item{post, pr.PostView.Post.ID}] = struct{}{}
				*/
			}
		case err := <-c.Errors():
			log.Warn("Lemmy client error").Err(err).Send()
		case <-ctx.Done():
			repliedStore, err := os.Create("replied.bin")
			if err != nil {
				log.Warn("Error creating reply store file").Err(err).Send()
				return
			}

			err = msgpack.NewEncoder(repliedStore).Encode(repliedIDs)
			if err != nil {
				log.Warn("Error encoding replies to reply store").Err(err).Send()
			}

			repliedStore.Close()
			return
		}
	}
}

type replyJob struct {
	Content   string
	CommentID types.Optional[int]
	PostID    int
}

func commentReplyWorker(ctx context.Context, c *lemmy.WSClient, ch <-chan replyJob) {
	for {
		select {
		case reply := <-ch:
			err := c.Request(types.UserOperationCRUDCreateComment, types.CreateComment{
				PostID:   reply.PostID,
				ParentID: reply.CommentID,
				Content:  reply.Content,
			})
			if err != nil {
				log.Warn("Error while trying to create new comment").Err(err).Send()
			}

			log.Info("Created new comment").
				Int("post-id", reply.PostID).
				Int("parent-id", reply.CommentID.ValueOr(-1)).
				Send()
		case <-ctx.Done():
			return
		}
	}
}

func executeTmpl(tmpl *template.Template, tc TmplContext) (string, error) {
	sb := &strings.Builder{}
	err := tmpl.Execute(sb, tc)
	return sb.String(), err
}

func joinAll(c *lemmy.WSClient) {
	err := c.Request(types.UserOperationUserJoin, nil)
	if err != nil {
		log.Fatal("Error joining WebSocket user context").Err(err).Send()
	}

	err = c.Request(types.UserOperationCommunityJoin, types.CommunityJoin{
		CommunityID: 0,
	})
	if err != nil {
		log.Fatal("Error joining WebSocket community context").Err(err).Send()
	}
}

// toSubmatches converts matches coming from PCRE2 to a submatch array used for the template
func toSubmatches(s [][]string) []Submatches {
	// Unfortunately, Go doesn't allow for this conversion even though the memory layout is identical and it's safe, so it is done using unsafe pointer magic
	return *(*[]Submatches)(unsafe.Pointer(&s))
}




type V_unsafe struct {
	Status bool `json:"status"`

	/*"unsafe": {
		"status": true,
	}*/
}
type V_metadata struct {
	Name     string `json:"name"`
	Desc     int    `json:"description"`
	Unlisted bool   `json:"is_unlisted"`
	Duration int    `json:"duration"`
	Lang     string `json:"language"`
	Channel  string `json:"uploader"`
	/*"metadata": {
		"name": "La géopolitique expliquée avec des pixels",
		"description": "Si on enlève le L de pixel ça fait pixe et ça veut rien dire. \n\nPatreon : https://www.patreon.com/TheGreatReview\nTwitch : https://www.twitch.tv/thegreatreview\nTiktok : https://www.tiktok.com/@thegreatreview_ \nTwitter : https://twitter.com/TheGreatReview_ \nInstagram : https://www.instagram.com/thegreatreview_/ \n\n\nIl est actuellement une heure 12 du matin figurez-vous, mais d'ici à ce que je finisse d'écrire cette phrase j'ai déjà menti parce qu'il est une heure 13, on peut vraiment faire confiance à personne. \n\n\n\n00:00 Intro\n00:22 La page d'accueil à un million de dollars\n02:04 C'est quoi Reddit\n03:02 Les règles de Place\n04:15 Place 2017 intro\n05:16 La montée d'un empire\n06:37 Qui a peur du void ?\n07:47 Le pouvoir d'un streamer et la chute d'un empire\n09:25 La diplomatie ça marche vachement bien\n14:03 OSU et la guerre\n19:00 Les petites histoires de Place\n20:16 Les aventures du Mexique\n22:52 C'est fini\n24:02 Cercle de confiance\n24:43 Le bouton\n28:12 Opening Place 2022\n28:52 D'adorables dessins évolutifs\n32:36 Mille choses à découvrir\n36:07 XQC le zerg\n38:08 Stream FR contre le monde \n43:00 Le futur c'est l'accessibilité \n46:29 Ce qu'on voit sur les heatmaps\n47:23 Let it snow\n\n\n\n\n#pixelwar #reddit #rplace",
		"is_unlisted": false,
		"duration": 3001,
		"language": "fr",
		"uploader": "TheGreatReview",
	}*/
}
type Video struct {
	Uid      string     `json:"uid"`
	Cmps     int        `json:"n_comparisons"`
	Usrs     int        `json:"n_contributors"`
	Score    float32    `json:"tournesol_score"`
	Unsafe   V_unsafe   `json:"unsafe"`
	Metadata V_metadata `json:"metadata"`

	/*"uid": "yt:qVZhwYupcg4",
	"n_comparisons": 21,
	"n_contributors": 9,
	"tournesol_score": 19.428705560639763,*/
}
func getJson(url string) *Video {
	client := http.Client{Timeout: 1000,}
	resp, errr := client.Get(url)
	if errr != nil {
		return nil
	}
	
	v := Video{}
	var unmarshalErr *json.UnmarshalTypeError

	decoder := json.NewDecoder(resp.Body)
	decoder.DisallowUnknownFields()
	err := decoder.Decode(&v)
	if err != nil {
		if errors.As(err, &unmarshalErr) {
			log.Error("Bad Request. Wrong Type provided for field "+unmarshalErr.Field)
		} else {
			log.Error("Bad Request "+err.Error())
		}
		return nil
	}
	return &v

}