# Changelog

## 1.8.2

- The last discovered TV address is remembered and used when discovery finds nothing, so the remote and the power button keep working after a restart while the TV is in standby.

## 1.8.1

- Older webOS TVs (2014–2017): falls back from `wss://:3001` to `ws://:3000`, loads app icons over HTTP and uses a corner toast when the centered alert isn't available.

## 1.8.0

- Opens inside Home Assistant through ingress, as a sidebar panel that also works away from home.

## 1.7.2

- `kumanda.local` now resolves on iPhones.

## 1.7.1

- Notification titles appear on their own line, and multi-line messages keep their line breaks.

## 1.7.0

- **Message on TV** box on the Remote tab.

## 1.6.0

- `POST /notify` endpoint to show messages on the TV, for example from Home Assistant automations.

## 1.5.0

- Live TV channels tab with search, a radio toggle and now/next program info from the TV's guide.

## 1.4.0

- English and Turkish interface with a TR/EN switch.
- Configurable web search engine.

## 1.3.1

- The volume level moved from the mute button to the header.

## 1.3.0

- First public release: keyboard, YouTube, web browser with touchpad, apps and inputs, media keys, volume and power. The TV is discovered automatically.
