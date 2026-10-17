# LG TV Web Remote

A small local server that lets you control an LG webOS TV from your phone's browser. No app to install: on the same Wi-Fi, just open **http://kumanda.local** on your phone.

Built and tested with an LG C4 (OLED55C46LA, webOS 24). It should work on other webOS TVs as well.

<p align="center">
  <img src="docs/screenshots/remote.png" width="200" alt="Remote tab with keyboard input, arrow keys and media keys">
  <img src="docs/screenshots/youtube.png" width="200" alt="YouTube tab with search results">
  <img src="docs/screenshots/web.png" width="200" alt="Web tab with address bar and touchpad">
  <img src="docs/screenshots/apps.png" width="200" alt="Apps tab with HDMI inputs and installed apps">
</p>

## Features

- **Keyboard**: Text you type on the phone goes straight into the TV's text field. Deletes, Enter and autocorrect are kept in sync.
- **YouTube**: Search on your phone and tap a result to play it in the TV's YouTube app. YouTube draws its own on-screen keyboard, so typing text doesn't reach it; this tab fills that gap.
- **Web**: Type an address to open it in the TV browser, or anything else to search the web (Yandex by default, configurable). Paste a YouTube link and it opens in the YouTube app. A **touchpad** controls the browser cursor: drag to move, tap to click, two fingers to scroll.
- **Apps**: Every app and HDMI input on the TV, with icons. Tap to open.
- **Live TV channels**: The TV's channel list with search and a radio toggle. Each channel shows what's on now, a progress bar and what's next, from the TV's own program guide. Tap a channel to switch to it.
- **Remote**: Arrow keys, OK, Back, Home, Settings and media keys (⏪ ▶ ⏸ ⏩).
- **Volume and power**: Volume up/down, mute and a live volume level. The power button turns the TV off, or wakes it with Wake-on-LAN when it's off.
- **English and Turkish**: The interface follows your phone's language. Switch it with the TR/EN button in the header; the choice is remembered.

The TV's IP and MAC address are discovered automatically: SSDP first, then mDNS (the TV's AirPlay advertisement), with the MAC address read from the ARP table.

## TV settings

1. Turn on **Settings → General → Devices → External Devices → TV On With Mobile → Turn on via Wi-Fi**. Without it, the power button can turn the TV off but not back on.
2. The first time the server connects, the TV shows a connection request. Press **Accept** on the remote. The pairing key is saved, so you only do this once.

## Installation

### As a Home Assistant add-on (recommended)

The server runs alongside Home Assistant and starts automatically on boot.

1. In Home Assistant, go to **Settings → Add-ons → Add-on Store → ⋮ → Repositories**.
2. Add `https://github.com/enesigneci/lg-tv-web-remote`.
3. Install and start the **LG TV Web Remote** add-on.
4. Open **http://kumanda.local** on your phone. If the name doesn't resolve, use your Home Assistant IP address.

Options on the add-on's **Configuration** tab:

| Option | Description |
| --- | --- |
| `tv_host` | The TV's IP address. Leave empty for auto-discovery. |
| `tv_mac` | The TV's MAC address for Wake-on-LAN. Leave empty for auto-discovery. |
| `hostname` | Name announced on the network. Defaults to `kumanda.local`. |
| `port` | Web server port. Defaults to `80`. |
| `search_engine` | Engine used for web searches: `yandex` (default), `google`, `duckduckgo` or `bing`. |

### On a computer (macOS, Linux, Raspberry Pi)

Requires Node.js 18 or newer.

```bash
cd tv_kumanda
npm install
npm start
```

Port 80 works out of the box on macOS but needs privileges on Linux. Pick another port there:

```bash
PORT=8080 npm start
```

Environment variables: `TV_HOST`, `TV_MAC`, `PORT`, `MDNS_NAME`, `KEY_FILE`, `SEARCH_ENGINE`. You can also pass the TV's IP as an argument: `node server.js 192.168.1.50`.

## How it works

- The server talks to the TV over the **webOS SSAP** protocol (`wss://TV:3001`) using the [lgtv2](https://github.com/hobbyquaker/lgtv2) library. Text goes through `com.webos.service.ime`; keys and the touchpad use the network input socket.
- YouTube videos are sent with the **YouTube Lounge API**, the same mechanism the YouTube phone app uses for "Play on TV". The TV's screen ID comes from DIAL.
- The `kumanda.local` name is announced by an mDNS responder running inside the server, so there's no need to rename your computer or Home Assistant host.

## Security

The `tv-key` file is the pairing key that grants control of your TV. It's listed in `.gitignore`; don't share it. The server has no authentication: anyone on your home network can use the remote. Don't expose it to the internet.

## License

MIT
