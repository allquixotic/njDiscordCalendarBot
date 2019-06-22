# njDiscordCalendarBot
Bot that posts parts of a Discord Calendar to Enjin as a picture.

At a high level, this bot logs into your Discord account and takes a screenshot of today's events on your event calendar, and posts them to Discord.

This is an experiment / tech test to become more familiar with discord.js, Puppeteer, and Node in general. More features may be added later, or maybe I'll cook up a new project using the same tech for a different purpose.

## config.json example:

```
  {
    "loginUrl": "https://example.enjin.com/login",
    "calendarUrl": "https://example.enjin.com/events",
    "discordSecret": "asdfg",
    "discordChannels": ["general"],
    "postRegexp": "!post",
    "username": "foo@example.com",
    "password": "changeme"
  }
```

## Config option semantics:

 - loginUrl: The URL on which the Enjin login form resides. Must be on the same Enjin domain/subdomain as your website so that the cookies for the login are scoped to your website.
 - calendarUrl: The URL on which your Enjin event calendar resides. This must be the "classic" calendar as of this writing; if any newer, fancier calendar module comes out after December 2018, it will not automatically be supported by this code; it will have to be updated.
 - discordSecret: The secret key/string to authenticate your bot to Discord. You can get this from your Discord dev settings (login to Discord as your real account on discordapp.com).
 - discordChannels: Not used currently. Planned to be a list of channels to periodically post to.
 - postRegexp: A string representing a JavaScript Regex defining the possible chat input strings that will cause the bot to post a screenshot of today's events in Discord. The bot posts in the same channel that it is asked from.
 - username: Enjin username/email address.
 - password: Enjin password.
