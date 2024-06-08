import { LemmyHttp } from 'lemmy-js-client'
import { createRequire } from 'module'
import https from 'https'
const loadJson = createRequire(import.meta.url)

// Constants
const CONFIG = loadJson("../config.json")
const LEMMY_CLIENT = new LemmyHttp(CONFIG.lemmy.instance)
const LNG = {'fr': 47, 'en': 37}

// Cache
const tournesolMap = {} // vid: tournesol object

// Manage config
if(CONFIG.filter.min_days_old) {
	const maxdate = new Date()
	maxdate.setUTCDate(maxdate.getUTCDate()-CONFIG.filter.min_days_old)
	const maxisodate = maxdate.toISOString()
	if(!CONFIG.filter.date_before || maxisodate < CONFIG.filter.date_before) {
		CONFIG.filter.date_before = maxisodate
	}
}
if(CONFIG.filter.max_days_old) {
	const mindate = new Date()
	mindate.setUTCDate(mindate.getUTCDate()-CONFIG.filter.max_days_old)
	const minisodate = mindate.toISOString()
	if(!CONFIG.filter.date_after || minisodate > CONFIG.filter.date_after) {
		CONFIG.filter.date_after = minisodate
	}
}

/**
 * #############################
 **/

async function login() {
	let loginForm = {
		username_or_email: CONFIG.lemmy.user,
		password: CONFIG.lemmy.password,
	};
	console.log('## -->', 'login', CONFIG.lemmy.user)
	try {
		const response = (await LEMMY_CLIENT.login(loginForm))
		const headers = {
			'authorization': `Bearer ${response.jwt}`
		}
		console.debug(headers)
		LEMMY_CLIENT.setHeaders(headers)
		return response.jwt
	} catch(e) {
		console.error(e)
		process.exit(-1)
	}
}

async function isReachable(target) {
	const delay = 200
	const times = 10
	return new Promise((res, rej) => {
		(function rec(i) {
			fetch(target, {mode: 'no-cors'}).then( // fetch the resourse
				_ => res(true) // resolve promise if success
			).catch( _ => {
				if (i === 0) return res(false) // if number of tries reached: don't try again
				process.stdout.write('.')
				setTimeout(() => rec(i-1), delay ) // otherwise, wait and try again until no more tries
			})
		})(times)
	})
}

async function getSelfCommentsPosts(auth) {
	const PER_PAGE=50

	const allSelfComments = []
	for(let page=1; true; page++) {
		let getPersonDetailsRequest = {
			auth: auth,
			username: CONFIG.lemmy.user,
			limit: PER_PAGE,
			page: page,
			sort: CONFIG.sort,
		}
		console.log('## -->', 'getPersonDetails', CONFIG.lemmy.user, 'page', page)
		const response = (await LEMMY_CLIENT.getPersonDetails(getPersonDetailsRequest)).comments

		if(!response.length) {
			break
		}

		for(const c of response) {
			allSelfComments.push(c.comment)
		}
	}
	return allSelfComments;
}

async function isSelfCommented(auth, post) {
	const PER_PAGE = 50
	let cmcnts = 0
	for(let page = 1; true; page++) {
		let getPersonDetailsRequest = {
			auth: auth,
			post_id: post.id,
			page: page,
			limit: PER_PAGE,
			type_: 'All',
		}
		console.log('## -->', 'getComments', post.ap_id, post.id, 'page', page)
		const ans = (await LEMMY_CLIENT.getComments(getPersonDetailsRequest))
		const comments = ans.comments
		if(!comments.length) {
			break
		}
		cmcnts += comments.length
		for(let c of comments) {
			if(c.creator.name === CONFIG.lemmy.user) {
				return -1
			}
		}
	}
	return cmcnts
}


async function manualCallLemmyGET(auth, url) {
	return new Promise((resolve,reject)=>{
		console.log('## -->', 'lemmy', url)
		https.get(url, {
			headers: {
				authorization: auth,
				Cookie: 'jwt=' + auth,
			}
		}, res => {
			let data = ''
			res.on('data', chunk => data += chunk)
			res.on('error', (e) => {
				console.error("### ERROR ###")
				console.error(e)
				console.log(data)
				exit(-2)
			})
			res.on('end', () => {
				try {
					if(res.statusCode !== 200 && res.statusCode !== 404) {
						console.warn(url, 'responded with code:', res.statusCode)
					}
					if(res.statusCode >= 300) {
						return reject(res.statusCode)
					}
					resolve(JSON.parse(data))
				} catch(e) {
					console.error(e)
					reject(null)
				}
			})
		})
	})
}

async function getCommunities(auth) {
	const PER_PAGE=50

	const allCommunities = []
	for(let page=1; true; page++) {

		let listCommunitiesRequest = {
			auth: auth,
			type_: 'Subscribed',
			show_nsfw: false,
			page: page,
			limit: PER_PAGE,
		}
		console.log('## -->', 'listCommunities', 'page', page)
		// const response = (await LEMMY_CLIENT.listCommunities(listCommunitiesRequest)).communities

		const rr = await manualCallLemmyGET(auth, `https://jlai.lu/api/v3/community/list?type_=${listCommunitiesRequest.type_}&limit=${listCommunitiesRequest.limit}&page=${page}`)
		const response = rr.communities

		if(!response.length) {
			break
		}
		for(const c of response) {
			if(!c.blocked && !c.posting_restricted_to_mods && !c.deleted && !c.removed) {
				allCommunities.push(c.community)
			}
		}
	}
	console.log(allCommunities.map(c=>c.name))
	return allCommunities;
}

async function getCommunityPosts(auth, community, page) {
	const PER_PAGE=10
	const posts = [];

	let getPostsRequest = {
		auth: auth,
		community_id: community.id,
		sort: CONFIG.sort,
		page: page,
		limit: PER_PAGE,
	}
	console.log('## -->', 'getPosts', community.actor_id, 'page', page)
	const response = (await LEMMY_CLIENT.getPosts(getPostsRequest)).posts

	for(const p of response) {
		if(!p.removed && !p.deleted && !p.locked && (p.counts?.upvotes||0) >= (p.counts?.downvotes||0)) {
			posts.push(p.post)
		}
	}

	return posts;
}

async function sendComment(post, content, lng) {
	let createCommentRequest = {
		content: content,
		language_id: (LNG[lng] || 0),
		post_id: post.id
	}
	console.log('\n## -->', 'createComment')
	try {
		const response = (await LEMMY_CLIENT.createComment(createCommentRequest)).comment_view.comment
		console.log(response.ap_id, 'published on', response.published, '\n')
		return true
	} catch(e) {
		console.error('Failed to send comment on', post.ap_id, ':', e.message, '\n')
		return false
	}
}

async function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function preloadTournesol(url) {
	let offset = 0
	if(!url) {
		url = 'https://api.tournesol.app/polls/videos/recommendations/?limit=2500&unsafe=false&duration_gte=2'
	} else {
		offset = url.match(/&offset=([0-9]+)/)[1]
	}
	return new Promise((resolve,reject)=>{
		console.log('## -->', 'tournesol', 'top-recommendations', offset)
		https.get(url, res => {
			let data = ''
			res.on('data', chunk => data += chunk)
			res.on('error', (e) => {
				console.error("### ERROR ###")
				console.error(e)
				console.log(data)
				reject()
			});
			res.on('end', () => {
				try {
					if(res.statusCode !== 200 && res.statusCode !== 404) {
						console.warn('https://api.tournesol.app/polls/videos/recommendations/', 'responded with code:', res.statusCode)
					}
					if(res.statusCode >= 300) {
						return reject(res.statusCode)
					}
					const parsed = JSON.parse(data)
					for(const vdata of parsed['results']) {
						vdata['ranking'] = Object.keys(tournesolMap).length + 1
						tournesolMap[vdata['entity']['uid']] = vdata
					}
					const nexturl = parsed['next']
					if(nexturl) {
						sleep((CONFIG.ms_wait_between_call_to_tournesol_api || 2500)).then(()=>preloadTournesol(nexturl).then(resolve))
					} else {
						resolve()
					}
				} catch(e) {
					console.error(e)
					reject()
				}
			})
		})
	})
}


/**
 * #############################
 **/

async function processPost(auth, post) {
	// Check post date
	if(CONFIG.filter.date_before && post.published > CONFIG.filter.date_before) {
		return
	}
	if(CONFIG.filter.date_after && (post.updated || post.published) < CONFIG.filter.date_after) {
		return
	}

	if(post.locked) {
		// Post is locked
		return
	}

	// Validate post is about youtube video
	const valid = [
		/^https?:\/\/youtu\.be\/([A-z0-9_-]{11})/,
		/^https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:[^w][^/]+\/)*watch\?v=([A-z0-9_-]{11})/,
		/^https?:\/\/(?:piped\.(?:video|projectsegfau\.lt)|yewtu\.be|inv\.tux\.pizza|invidious\.[^/]+|watch\.whatever\.social)\/(?:watch?v=)([A-z0-9_-]{11})/,
	]
	const matching = valid.map(v=>v.exec(post.url)).filter(v=>v)
	if(!matching.length) {
		// Not about a video
		return
	}

	const vid = 'yt:' + matching[0][1]
	post.vid = vid

	// Check for presence on Tournesol
	let tournesol = tournesolMap[vid]

	if(!tournesol || !tournesol.collective_rating || !tournesol.entity) {
		// Not found on Tournesol or unsafe
		// console.log('Not found on tournesol:', vid)
		return
	}

	/* tournesol:
		{
			"entity":{
				"uid":"yt:xdk2Sargd3o",
				"type":"video",
				"metadata":{
					"name":"Le merveilleux projet d'oléoduc en Afrique  - AMI DES LOBBIES #20",
					"tags":["EACOP","pétrole","afrique","environnement","écologie","total","lions","éléphants","singes"],
					"views":102392,
					"source":"youtube",
					"duration":269,
					"language":"fr",
					"uploader":"Ami des lobbies",
					"video_id":"xdk2Sargd3o",
					"channel_id":"UCkkY_V2YSa_oln5CXm4zDzw",
					"description":"...",
					"is_unlisted":false,
					"publication_date":"2022-05-23T15:37:09Z"
				}
			},
			"collective_rating":{
				"n_comparisons":329,
				"n_contributors":151,
				"tournesol_score":45.601289656621454,
				"unsafe":{"status":false,"reasons":[]},
				"criteria_scores":[
					{"criteria":"backfire_risk","score":21.379239359389857},
					{"criteria":"better_habits","score":29.94144618630178},
					{"criteria":"diversity_inclusion","score":25.343948016515522},
					{"criteria":"engaging","score":43.90349149083634},
					{"criteria":"entertaining_relaxing","score":41.02606709179594},
					{"criteria":"importance","score":43.407551541504134},
					{"criteria":"largely_recommended","score":45.601289656621454},
					{"criteria":"layman_friendly","score":38.4367507046913},
					{"criteria":"pedagogy","score":34.87100187654803},
					{"criteria":"reliability","score":32.40162648607968}
				]
			},
			"entity_contexts":[],
			"recommendation_metadata":{"total_score":null}
		}
	*/

	try {
		console.log(vid, post.ap_id,
			'scr:'+(Math.round(tournesol.collective_rating.tournesol_score)|0),
			'cmp:'+tournesol.collective_rating.n_comparisons,
			'ctr:'+tournesol.collective_rating.n_contributors,
			'lng:'+tournesol.entity.metadata.language,
			'--',
			tournesol.entity.metadata.uploader + ':', tournesol.entity.metadata.name
		)

		if(tournesol.collective_rating.tournesol_score < 20 || tournesol.collective_rating.n_comparisons < 10) {
			console.log('\tTournesol Score or Comparisons count too low\n')
			return
		}

		let message = null;
		let adjective = 'recommended';
		let score = (Math.round(tournesol.collective_rating.tournesol_score)|0) + '🌻'
		switch(tournesol.entity.metadata.language) {
			case 'en':
				adjective = tournesol.collective_rating.tournesol_score < 40 ? 'recommended' : 'highly recommended'
				message = `This video is ${adjective} by [Tournesol](https://tournesol.app/about) community:\\
[${score}] ${tournesol.entity.metadata.uploader}: [${tournesol.entity.metadata.name}](https://tournesol.app/entities/${vid})

*#Tournesol is an open-source web tool made by a non profit organization, evaluating the overall quality of videos to fight against misinformation and dangerous content.*`
				break
			case 'fr':
				adjective = tournesol.collective_rating.tournesol_score < 45 ? 'recommandée' : 'fortement recommandée'
				message = `Cette vidéo est ${adjective} par la communauté de [Tournesol](https://tournesol.app/about):\\
[${score}] ${tournesol.entity.metadata.uploader}: [${tournesol.entity.metadata.name}](https://tournesol.app/entities/${vid})

*#Tournesol est un outil web open-source développé par une association non caritative, qui évalue la qualité des vidéos pour combattre les fake-news et les contenus non recommandables.*`
				break
			default:
				console.log('\tLanguage "' + tournesol.entity.metadata.language + '" is not supported\n')
				return
		}

		// Check that post is not already responded (not present in self comments)
		const comments = await isSelfCommented(auth, post)
		/*if(comments === 0) {
			console.log('\tNo comment found on the post\n')
			return
		}*/
		if(comments === -1) {
			console.log('\tPost has already been replied\n')
			return
		}

		// Check that original post is available (if not, selfcomment detection may have fail)
		if(! await isReachable(post.ap_id)) {
			console.log("\tHost isn't reachable\n")
			return
		}

		// Send the actual message
		if(CONFIG.fake_sending_comments) {
			console.log("\tfake_sending_comments:true -- Comment hasn't been sent\n")
			return true
		}
		return await sendComment(post, message, tournesol.entity.metadata.language)
	} catch(e) {
		console.error(e)
		console.log(tournesol)
		process.exit(-1)
	}
}

async function main() {

	// Preload tournesol top videos
	try {
		await preloadTournesol()
	} catch(e) {
		// ignore
	}

	const jwt = await login()

	const alreadyCommented = await getSelfCommentsPosts(jwt)
	const alreadyCommentedPosts = alreadyCommented.map(c=>c.post_id)
	console.log('Already replied to ' + alreadyCommentedPosts.length + ' posts')

	const communities = await getCommunities(jwt)
	console.log('Listed', communities.length, 'communities')

	const stopped = []
	let page = 1
	while(stopped.length < communities.length) {
		for(const community of communities) {
			if(stopped.includes(community.id)) continue
			let posts = []
			try {
				await sleep(500)
				posts = await getCommunityPosts(jwt, community, page)

				// Shortcut
				if(CONFIG.sort === 'Old' && posts.length && posts[posts.length-1].published > CONFIG.filter.date_before) {
					stopped.push(community.id)
				}
				if(CONFIG.sort.startsWith('Top') && posts.length && posts[posts.length-1].score <= 0) {
					stopped.push(community.id)
				}
			} catch(e) {
				console.log(e)
			}
			if(!posts.length) {
				console.log('No more posts found for', community.actor_id)
				stopped.push(community.id)
				continue
			}

			posts.sort((a,b)=>{
				return a.published < b.published ? -1 : 1;
			})

			for(const post of posts) {
				if(alreadyCommentedPosts.includes(post.id)) {
					continue
				}
				const anythingWasPosted = await processPost(jwt, post)
				if(anythingWasPosted) {
					console.log(post)
					stopped.push(community.id)

					if(!CONFIG.fake_sending_comments) {
						// Wait a bit before to continue
						console.log('Message sent, waiting some time before continuing to avoid spamming')
						for(let i=(CONFIG.minutes_to_wait_between_comments || 15); i>0; i--) {
							console.log('Still waiting (' + i + 'min remaining)...')
							await sleep(60*1000)
						}
					}

					// Do not post anymore on this community for this run
					break
				}
			}
		}
		page++
	}

}

/**
 * #############################
 **/

await main()
