# Lemmy Tournesol Bot

Bot looking on Lemmy for posts having youtube video link, and comment with Tournesol.app link if recommended

[tournesol.app](https://tournesol.app) is an open-source web tool created by a non profit organization aiming to evaluate the overall quality of the information in web videos in order to fight against misinformation and other dangerous content with the help of collaborative comparisons.

To know more about it, check out https://tournesol.app/about

### Features

- Get Lemmy content from subscribed communities
- Ignore locked or removed communities and posts
- Ignore posts where it has already commented
- Supports English and French (uses Tournesol API for language detection)
- Waits 10min between messages to prevent spam (either as error or not)
- Supports links from: youtube.com, youtu.be, piped.video, piped.projectsegfau.lt

### Plan of improvements

- Support more piped alternatives
- Support mode sort by "Old", and process posts progressively instead of requesting all lemmy posts first (not sustainable for future)
	- Add time limit in settings (ignore posts older than this)
- Store Tournesol 404 responses in a cache file to prevent to retry them next time the bot is launched (reduce calls to Tournesol API & accelerate launch)
	- Add an option to retry them if not retried for a long time
- Alternate posts to avoid spamming similar content
	- on different communities (avoid posting on the same community twice in a row)
	- on posts showing the same video
	- on posts showing videos from the same creator
	- on posts showing videos from the same language (to improve diversity)
- Upvote users having used Tournesol links directly in their posts, and posts about video having a great Tournesol score (to improve their recommendation)
- Write every week the community Post of [!tournesol@jlai.lu](https://jlai.lu/c/tournesol) and [!tournesol@sh.itjust.works](https://sh.itjust.worksc/tournesol) 

### Configuration

- Copy file `config.json.example` as `config.json` (to save in the same folder)
- Modify the values inside as needed

### Building and Running

`npm run start`
