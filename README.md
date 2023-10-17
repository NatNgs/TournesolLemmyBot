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

### Configuration

- Copy file `config.json.example` as `config.json` (keep it in the same folder)
- Modify the values inside as needed

### Building and Running

`npm run start`
