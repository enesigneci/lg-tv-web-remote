# LG TV Web Remote

Control your LG webOS TV from any phone or computer browser on your home network: type into the TV, play YouTube videos, open web pages, switch apps, inputs and live TV channels, and change the volume or turn the TV on and off.

## First-time setup

1. On the TV, turn on **Settings → General → Devices → External Devices → TV On With Mobile → Turn on via Wi-Fi**. Without it, the power button can turn the TV off but not back on.
2. Start the add-on. It finds the TV on your network by itself.
3. The TV shows a connection request the first time. Press **Accept** on the TV remote. The pairing is saved, so you only do this once.

## Opening the remote

- **On your phone:** open **http://kumanda.local** while you're on the home Wi-Fi. If that name doesn't open, use your Home Assistant IP address instead, for example `http://192.168.1.10`. Add it to your home screen for one-tap access.
- **Inside Home Assistant:** turn on **Show in sidebar** on the **Info** tab to get a **TV Remote** entry. This also works away from home through your Home Assistant remote access.

## Options

| Option | Description |
| --- | --- |
| `tv_host` | The TV's IP address. Leave empty to discover it automatically. If your router or DHCP server gives the TV a fixed address, entering it here makes start-up independent of discovery. |
| `tv_mac` | The TV's MAC address, used to wake it. Leave empty to discover it automatically. |
| `hostname` | Name announced on your network. Default: `kumanda.local`. |
| `port` | Port of the web page. Default: `80`. Change it if another add-on already uses port 80. |
| `search_engine` | Used by the Web tab for anything that isn't an address: `yandex` (default), `google`, `duckduckgo` or `bing`. |

## Notifications on the TV

The **Message on TV** box at the bottom of the Remote tab shows a message in the middle of the TV screen. Automations can do the same through `POST /notify`. Add this to `configuration.yaml`:

```yaml
rest_command:
  tv_notify:
    url: http://127.0.0.1/notify
    method: POST
    content_type: application/json
    payload: >-
      {"title": {{ title | default("") | tojson }}, "message": {{ message | tojson }}, "seconds": {{ seconds | default(15) }}}
```

Then call it from any automation:

```yaml
action: rest_command.tv_notify
data:
  title: Dishwasher
  message: The dishes are done.
```

`127.0.0.1` works because the add-on runs on the host network. If you changed `port`, add it to the URL, for example `http://127.0.0.1:8080/notify`.

## Troubleshooting

- **The add-on log keeps saying "TV not found on the network".** TVs in standby stop announcing themselves. Turn the TV on once, or enter `tv_host` and `tv_mac`. After the first successful connection the add-on remembers the address.
- **The power button turns the TV off but not on.** Check the **TV On With Mobile** setting above. The log line `TV: … (MAC …)` shows whether the MAC address is known.
- **`kumanda.local` doesn't open.** Use the Home Assistant IP address. Some guest or isolated Wi-Fi networks block the multicast traffic that `.local` names need.
- **The TV asks to accept the connection again.** The pairing key was lost, for example after reinstalling the add-on. Accept it once more.
- **YouTube search shows results but nothing plays.** Open the YouTube app on the TV once so it is signed in and ready, then try again.

## Security

There is no login on the web page: anyone on your home network can use the remote. Don't forward its port to the internet. For access away from home, use the sidebar entry, which goes through Home Assistant's login.
