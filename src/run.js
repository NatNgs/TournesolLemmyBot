import { LemmyHttp } from 'lemmy-js-client'
import { createRequire } from 'module'
import https from 'https'

const loadJson = createRequire(import.meta.url)

const CONFIG = loadJson("../config.json")

// Cache
const tournesolMap = {} // vid: tournesol object

/**
 * #############################
 **/

async function login() {
	let loginForm = {
		username_or_email: CONFIG.lemmy.user,
		password: CONFIG.lemmy.password,
	};
	console.log('## -->', 'login', CONFIG.lemmy.user)
	const response = (await client.login(loginForm))
	return response.jwt
}

async function getSelfCommentsPosts(auth) {
	const PER_PAGE=50
	let page=1

	const allSelfComments = []

	while(true) {

		let getPersonDetailsRequest = {
			auth: auth,
			username: CONFIG.lemmy.user,
			limit: PER_PAGE,
			page: page,
			sort: CONFIG.filter.sort,
		}
		console.log('## -->', 'getPersonDetails', CONFIG.lemmy.user, page)
		const response = (await client.getPersonDetails(getPersonDetailsRequest)).comments

		for(const c of response) {
			allSelfComments.push(c.comment)
		}

		if(response.length < PER_PAGE) {
			break
		}
		page++
	}
	return allSelfComments;
}

async function getCommunities(auth) {
	const PER_PAGE=50
	let page=1

	const allCommunities = []

	while(true) {

		let listCommunitiesRequest = {
			auth: auth,
			type_: 'Subscribed',
			show_nsfw: false,
			page: page,
			limit: PER_PAGE,
		}
		console.log('## -->', 'listCommunities', page)
		const response = (await client.listCommunities(listCommunitiesRequest)).communities

		for(const c of response) {
			if(!c.blocked) {
				allCommunities.push(c.community)
			}
		}

		if(response.length < PER_PAGE) {
			break
		}
		page++
	}
	return allCommunities;
}

async function getCommunityPosts(auth, community, page) {
	const PER_PAGE=50
	const posts = [];

	let getPostsRequest = {
		auth: auth,
		community_id: community.id,
		sort: CONFIG.filter.sort,
		page: page,
		limit: PER_PAGE,
	}
	console.log('## -->', 'getPosts', community.actor_id, 'page', page)
	const response = (await client.getPosts(getPostsRequest)).posts

	for(const p of response) {
		if(!p.removed && !p.deleted && !p.locked) {
			posts.push(p.post)
		}
	}

	return posts;
}

const LNG = {'fr': 47, 'en': 37}
async function sendComment(post, content, lng) {
	const auth = await login()

	let createCommentRequest = {
		auth: auth,
		content: content,
		language_id: (LNG[lng] || 0),
		post_id: post.id
	}
	console.log('\n## -->', 'createComment')
	const response = (await client.createComment(createCommentRequest)).comment_view.comment
	console.log(response.ap_id, 'published on', response.published, '\n')
}

async function callTournesol(vid) {
	return new Promise((resolve,reject)=>{
		const req = https.get('https://api.tournesol.app/entities/yt:' + vid + '/', res => {
			let data = ''
			res.on('data', chunk => data += chunk)
			res.on('error', reject);
			res.on('end', () => {
				try {
					if(res.statusCode !== 404) {
						console.log('https://api.tournesol.app/entities/yt:' + vid + '/', 'responded with code:', res.statusCode)
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

async function sleep(ms) {
	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

/**
 * #############################
 **/

async function processPost(post, alreadyCommentedPosts) {
	// Check post date
	if(post.updated) {
		if(post.updated < CONFIG.filter.date_after) {
			return
		}
	} else if(post.published < CONFIG.filter.date_after) {
		return
	}

	// Validate post is about youtube video
	const valid = [
		/^https?:\/\/youtu\.be\/([A-z0-9_-]{11})/,
		/^https?:\/\/(?:www\.|m\.)?youtube\.com\/(?:[^w][^/]+\/)*watch\?v=([A-z0-9_-]{11})/,
		/^https?:\/\/piped\.(?:video|projectsegfau\.lt)\/(?:watch?v=)([A-z0-9_-]{11})/,
	]
	const matching = valid.map(v=>v.exec(post.url)).filter(v=>v)
	if(!matching.length) {
		return
	}

	// Check that post is not already responded (not present in self comments)
	if(alreadyCommentedPosts.includes(post.id)) {
		return
	}

	const vid = matching[0][1]
	post.vid = vid

	// Check for presence on Tournesol
	let tournesol = null

	if(vid in tournesolMap) {
		tournesol = tournesolMap[vid]
	} else {
		await sleep((CONFIG.ms_wait_between_call_to_tournesol_api || 2500))
		try {
			tournesol = await callTournesol(vid)
		} catch(e) {
			tournesol = null
		}
		tournesolMap[vid] = tournesol
	}
	if(!tournesol) {
		return
	}

	if(tournesol.tournesol_score < 20) {
		console.log('score', tournesol.tournesol_score, '< 20')
		return
	}
	if(!['fr', 'en'].includes(tournesol.metadata.language)) {
		console.log('language "' + tournesol.metadata.language + '" is neither "en" nor "fr"')
		return
	}
	console.log(post.id, post.ap_id, '(' + tournesol.metadata.language + ')', 'is about: ', (tournesol.tournesol_score|0) + '🌻', tournesol.metadata.uploader + ':', tournesol.metadata.name)

	let message = '';
	if(tournesol.metadata.language == 'en') {
		message = `This video is recommended on [Tournesol](/c/tournesol@sh.itjust.works): \\
[+${(Math.round(tournesol.tournesol_score)|0)}🌻] [${tournesol.metadata.uploader}: ${tournesol.metadata.name}](https://tournesol.app/entities/yt:${vid})

Do you think this video should be more recommended ? If so, please compare it on tournesol to improve its ranking

-----
*[tournesol.app](https://tournesol.app) is an open-source web tool created by a non profit organization aiming to evaluate the overall quality of the information in web videos in order to fight against misinformation and other dangerous content with the help of collaborative comparisons.*

*To know more about it, see https://tournesol.app/about*

-----
*I'm a bot made by a community member not related to Tournesol organization. Feel free to reply, my owner is watching...*`;
	} else {
		message = `Cette vidéo est recommandée sur [Tournesol](/c/tournesol@jlai.lu): \\
[+${(Math.round(tournesol.tournesol_score)|0)}🌻] [${tournesol.metadata.uploader}: ${tournesol.metadata.name}](https://tournesol.app/entities/yt:${vid})

Penses-tu qu'elle doive être recommandée ? Si c'est le cas, n'hésite pas à la comparer sur Tournesol pour améliorer son classement

-----
*[tournesol.app](https://tournesol.app) est un outil web open-source développé par une association qui a pour but d'évaluer la qualité de l'information de vidéos à partir de comparaisons collaboratives faites par la communauté, et ainsi combattre les fake news et autres contenus non recommendables.*

*Pour en savoir plus:  https://tournesol.app/about*

-----
*Je suis un bot créé par un membre de la communauté qui ne fait pas partie de l'association Tournesol. N'hésitez pas à répondre à ce commentaire, mon créateur est pas loin...*`;
	}

	// Send the actual message
	await sendComment(post, message, tournesol.metadata.language)

	// Wait a bit before to continue
	console.log('Message sent, waiting some time before continuing to avoid spamming')
	for(let i=(CONFIG.minutes_to_wait_between_comments || 15); i>0; i--) {
		console.log('Still waiting (' + i + 'min remaining)...')
		await sleep(60*1000)
	}
}


/**
 * #############################
 **/

let client = new LemmyHttp(CONFIG.lemmy.instance)

const jwt = await login()

const alreadyCommented = await getSelfCommentsPosts(jwt)
console.log('Already replied to ' + alreadyCommented.length + ' posts')
const alreadyCommentedPosts = alreadyCommented.map(c=>c.post_id)

const communities = await getCommunities(jwt)
console.log('Listed', communities.length, 'communities')

const stopped = []
let page = 1
while(stopped.length < communities.length) {
	for(const community of communities) {
		if(community.id in stopped) continue
		let posts = []
		try {
			posts = await getCommunityPosts(jwt, community, page)
		} catch(e) {
			console.log(e)
		}
		if(!posts.length) {
			console.log('No more posts found for', community.actor_id)
			stopped.push(community.id)
			continue
		}
		console.log('Posts found', posts.length)

		posts.sort((a,b)=>{
			return a.published < b.published ? -1 : 1;
		})

		for(const post of posts) {
			await processPost(post, alreadyCommentedPosts)
		}
	}

}
