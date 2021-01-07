var express = require('express')
	, request = require('request')
	, multer = require('multer')
	, redis = require('redis')
	//, lwip = require('lwip')
	, jimp = require('jimp')
	, sha1 = require('sha1')
	, freegeoip = require('node-freegeoip');

// Configuration.
var appUrl = process.env.APP_URL || 'https://plex-de-jeremy-bot.herokuapp.com';
var webhookKey = process.env.DISCORD_WEBHOOK_KEY || '796482251575525396/dVu5hu7BoST6YwJMb9DCKVawuCTQYY8G43kau7ApIKkofkE2oejXkQM14rCwtr5I3jXm';

var redisClient = redis.createClient(process.env.REDISCLOUD_URL, { return_buffers: true });
var upload = multer({ storage: multer.memoryStorage() });
var app = express();

app.use(express.static('images'));

function formatTitle(metadata) {
	if (metadata.grandparentTitle) {
		return metadata.grandparentTitle;
	} else {
		let ret = metadata.title;
		if (metadata.year) {
			ret += ` (${metadata.year})`;
		}
		return ret;
	}
}

function formatSubtitle(metadata) {
	var ret = '';
	if (metadata.grandparentTitle) {
		if (metadata.type === 'track') {
			ret = metadata.parentTitle;
		} else if (metadata.index && metadata.parentIndex) {
			ret = `S${metadata.parentIndex} E${metadata.index}`;
		} else if (metadata.originallyAvailableAt) {
			ret = metadata.originallyAvailableAt;
		}

		if (metadata.title) {
			ret += ` - ${metadata.title}`;
		}
	} else if (metadata.type === 'movie') {
		ret = metadata.tagline;
	}

	return ret;
}

function formatSummary(summary) {
	var ret = '';

	if (summary && summary.length) {
		if (summary.length > 300) {
			ret += summary.substring(0, 300) + '...';
		}
		else {
			ret += summary;
		}

		if (ret.length > 0) {
			ret = `\r\n\r\n${ret}`;
		}
	}

	return ret;
}

function notifyDiscord(imageUrl, payload, action) {
	var data;
	const isVideo = payload.Metadata.librarySectionType === 'movie' || payload.Metadata.librarySectionType === 'show';
	const isAudio = payload.Metadata.librarySectionType === 'artist';

	if(action === "uploaded") {
		data = {
		"content": '',
		"username": 'JeremBot',
		"avatar_url": appUrl + '/images/user.jpg',
		"embeds": [
			{
				"title": formatTitle(payload.Metadata),
				"description": 'Bingo ! Le téléchargement de ' + formatTitle(payload.Metadata) + " vient de se terminer ! Connectez-vous à Plex pour le visionner !",
				"footer": {
					"text": 'le saviez-vous ? une abeille, ça pique !',
					"icon_url": appUrl + '/images/user.jpg'
				},
				"thumbnail": {
					"url": imageUrl,
					"height": 200,
					"width": '200'
				}
			}
		]
		};
	}else{
		data = {
		"content": '',
		"username": 'JeremBot',
		"avatar_url": appUrl + '/images/user.jpg',
		"embeds": [
			{
				"title": formatTitle(payload.Metadata),
				"description": formatSubtitle(payload.Metadata) + formatSummary(payload.Metadata.summary),
				"footer": {
					"text": `${action} par ${payload.Account.title}`,
					"icon_url": payload.Account.thumb
				},
				"thumbnail": {
					"url": imageUrl,
					"height": 200,
					"width": '200'
				}
			}
		]
		};
	}

		request.post(`https://discordapp.com/api/webhooks/${webhookKey}`,
			{ json: data },
			function (error, response, body) {
				if (!error && response.statusCode === 200) {
					//console.log(body)
				}
			}
		);

}

app.post('/', upload.single('thumb'), function (req, res, next) {
	var payload = JSON.parse(req.body.payload);
	const isVideo = payload.Metadata.librarySectionType === 'movie' || payload.Metadata.librarySectionType === 'show';
	const isAudio = payload.Metadata.librarySectionType === 'artist';

	if (payload.user === true && payload.Metadata && (isAudio || isVideo)) {
		var key = sha1(payload.Server.uuid + payload.Metadata.guid);

		if (payload.event === 'media.play' || payload.event === 'media.rate' || payload.event === 'library.new') {
			// Save the image.
			if (req.file && req.file.buffer) {
				jimp.read(req.file.buffer)
					.then(image => {
						image.contain(75, 75)
							.getBuffer(jimp.MIME_JPEG,
								(error, buffer) => {
									redisClient.setex(key, 7 * 24 * 60 * 60, buffer);
								});
					});
			}
		}

		if ((payload.event === 'media.scrobble' && isVideo) || payload.event === 'media.rate' || payload.event === 'media.play' || payload.event === 'library.new') {

				var action;
				if (payload.event === 'media.scrobble' || payload.event === 'media.play') {
					action = 'played';
				} else if (payload.event === 'media.rate') {
					if (payload.rating > 0) {
						action = 'rated';
						for (var i = 0; i < payload.rating / 2; i++)
							action += '★';
					} else {
						action = 'unrated';
					}
				}else if(payload.event === 'library.new'){
					action = 'uploaded';
				}

				// Send the event to Discord.
				redisClient.get(key, function (err, reply) {

						if (reply) {
							notifyDiscord(appUrl + '/images/' + key, payload, action);
						} else {
							notifyDiscord(null, payload, action);
						}

				});

		}
	}

	res.sendStatus(200);
});

app.get('/images/:key', function (req, res, next) {
	redisClient.get(req.params.key, function (err, value) {
		if (err) {
			next(err);
		} else {
			if (!value) {
				next();
			} else {
				res.setHeader('Content-Type', 'image/jpeg');
				res.end(value);
			}
		}
	});
});

app.listen(process.env.PORT || 11000);