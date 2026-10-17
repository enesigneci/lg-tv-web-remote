# LG TV Kumanda

Telefonun tarayıcısından LG webOS TV'yi kontrol etmeni sağlayan küçük bir yerel sunucu. Uygulama kurmaya gerek yok: aynı Wi-Fi'deyken telefondan **http://kumanda.local** adresini açman yeterli.

LG C4 (OLED55C46LA, webOS 24) ile geliştirildi ve test edildi. Diğer webOS TV'lerde de çalışması beklenir.

## Özellikler

- **Klavye**: Telefonda yazdığın metin TV'deki yazı alanına anında gider. Silme, Enter ve otomatik düzeltme de eşitlenir.
- **YouTube**: Arama telefonda yapılır, dokunduğun video TV'deki YouTube uygulamasında açılır. YouTube kendi ekran klavyesini kullandığı için yazı göndermek orada işe yaramaz, bu sekme o eksiği kapatır.
- **Web**: Adres yazarsan TV tarayıcısında açılır, başka bir şey yazarsan Yandex'te aranır. YouTube linki yapıştırırsan video YouTube uygulamasında açılır. Tarayıcıda imleci yönetmek için bir **touchpad** de var: sürüklemek imleci taşır, dokunmak tıklar, iki parmakla sayfa kaydırılır.
- **Uygulamalar**: TV'deki tüm uygulamalar ve HDMI girişleri ikonlarıyla listelenir, dokununca açılır.
- **Kumanda**: Yön tuşları, OK, Geri, Ana ekran, Ayarlar ve medya tuşları (⏪ ▶ ⏸ ⏩).
- **Ses ve güç**: Sesi açıp kısma, sessize alma ve anlık ses seviyesi. Güç tuşu TV'yi kapatır, kapalıysa Wake-on-LAN ile açar.

TV'nin IP ve MAC adresi ağda otomatik bulunur. Bunun için önce SSDP, olmazsa mDNS (AirPlay duyurusu) deneniyor, MAC adresi de ARP tablosundan okunuyor.

## TV'de yapılacak ayarlar

1. **Ayarlar → Genel → Cihazlar → Harici Cihazlar → Mobil ile TV'yi Aç → Wi-Fi ile aç** seçeneğini aç. Bu ayar olmadan Güç tuşu TV'yi kapatabilir ama tekrar açamaz.
2. Sunucu ilk kez bağlandığında TV ekranında bir bağlantı isteği çıkar, kumandayla **Kabul Et**'e bas. Eşleşme anahtarı kaydedildiği için bunu bir kez yapman yeterli.

## Kurulum

### Home Assistant eklentisi olarak (önerilen)

Sunucu Home Assistant'la birlikte sürekli açık kalır ve açılışta kendiliğinden başlar.

1. Home Assistant'ta **Ayarlar → Eklentiler → Eklenti Mağazası → ⋮ → Depolar** menüsüne gir.
2. `https://github.com/enesigneci/lg-tv-web-remote` adresini ekle.
3. **TV Kumanda** eklentisini kur ve başlat.
4. Telefondan **http://kumanda.local** adresini aç. Bu ad çözülmezse Home Assistant'ın IP adresini kullan.

Eklentinin **Yapılandırma** sekmesindeki ayarlar:

| Ayar | Açıklama |
| --- | --- |
| `tv_host` | TV'nin IP adresi. Boş bırakırsan otomatik bulunur. |
| `tv_mac` | Wake-on-LAN için TV'nin MAC adresi. Boş bırakırsan otomatik bulunur. |
| `hostname` | Ağa duyurulan ad. Varsayılanı `kumanda.local`. |
| `port` | Web sunucusunun portu. Varsayılanı `80`. |

### Bilgisayarda (macOS, Linux, Raspberry Pi)

Node.js 18 veya üstü gerekiyor.

```bash
cd tv_kumanda
npm install
npm start
```

80 portunu kullanmak macOS'ta sorun çıkarmaz, Linux'ta yetki ister. Linux'ta başka bir port seçebilirsin:

```bash
PORT=8080 npm start
```

Ortam değişkenleri: `TV_HOST`, `TV_MAC`, `PORT`, `MDNS_NAME`, `KEY_FILE`. TV'nin IP'sini komut satırı argümanı olarak da verebilirsin: `node server.js 192.168.1.50`.

## Nasıl çalışıyor

- TV ile **webOS SSAP** protokolü üzerinden konuşuluyor (`wss://TV:3001`). Bu iş için [lgtv2](https://github.com/hobbyquaker/lgtv2) kütüphanesi kullanılıyor. Yazı göndermek için `com.webos.service.ime`, tuşlar ve touchpad için ağ giriş soketi kullanılıyor.
- YouTube videoları, telefondaki YouTube uygulamasının "TV'de oynat" özelliğinin kullandığı **YouTube Lounge API** ile gönderiliyor. TV'nin ekran kimliği DIAL üzerinden alınıyor.
- `kumanda.local` adı, sunucunun içinde çalışan bir mDNS yanıtlayıcısıyla duyuruluyor. Bu yüzden bilgisayarın ya da Home Assistant'ın adını değiştirmek gerekmiyor.

## Güvenlik

`tv-key` dosyası TV'yi kontrol etme yetkisi veren eşleşme anahtarıdır. `.gitignore` dosyasında listeli, onu paylaşma. Sunucuda kimlik doğrulama yok: ev ağındaki herkes kumandayı kullanabilir. Sunucuyu internete açma.

## Lisans

MIT
