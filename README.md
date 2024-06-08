# Lemmy Tournesol Bot

Bot looking on Lemmy for posts having youtube video link, and comment with Tournesol.app link if recommended

[tournesol.app](https://tournesol.app) is an open-source web tool created by a non profit organization aiming to evaluate the overall quality of the information in web videos in order to fight against misinformation and other dangerous content with the help of collaborative comparisons.

To know more about it, check out https://tournesol.app/about

### Features

- Get Lemmy content from subscribed communities
- Ignore locked or removed communities and posts
- Ignore posts where it has already commented
- Supports English and French (uses Tournesol API for language detection)
- Waits between messages to prevent spam
- Avoid posting on the same community twice in a row
- Supports links from: youtube.com, youtu.be, piped.video, piped.projectsegfau.lt

### Plan of improvements

- Support more piped alternatives
- Alternate posts to avoid spamming similar content
	- on posts showing the same video
	- on posts showing videos from the same creator
	- on posts showing videos from the same language (to improve diversity)
- Write every week the community Post of [!tournesol@jlai.lu](https://jlai.lu/c/tournesol) and [!tournesol@sh.itjust.works](https://sh.itjust.worksc/tournesol) 
- Write a message for highly unrecommended videos

### Configuration

- Copy file `config.json.example` as `config.json` (to save in the same folder)
- Modify the values inside as needed

### Building and Running

`npm run start`
