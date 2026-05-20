# HideSeenFriendRequests

A BetterDiscord plugin that lets you mark incoming pending friend requests as seen so they no longer contribute to Discord's pending friend request notification count.

![HideSeenFriendRequests demo](demo.gif)

- Adds an eye button to each visible incoming pending friend request row.
- Click the eye button to mark a request as seen.
- Seen pending requests are subtracted from Discord's pending friend request count.
- Click the button again to mark the request as unseen.
- Seen request IDs are saved locally through BetterDiscord data storage.

## Local Data

The plugin stores seen pending request IDs in BetterDiscord's data storage under:

```text
HideSeenFriendRequests.config.json
```

If a request is no longer pending, the plugin ignores that saved ID when calculating the visible pending count.

## Compatibility

This plugin depends on Discord's internal relationship store and the current BetterDiscord API. Discord updates can change internal APIs or class names, so the plugin may need maintenance if the pending friend request UI changes.
