# Receipt to Paperless

A small, self-hosted web app for photographing receipts on your phone and sending them to [Paperless-ngx](https://docs.paperless-ngx.com/). Paperless processes the document and performs OCR as configured there. Upload acceptance means the receipt has been queued, not that processing has finished.

## Requirements

- Node.js 20 or later (or Docker)
- A reachable Paperless-ngx server and an API token with permission to add documents
- A phone that can reach the app

## Run

Set the following environment variables (see `.env.example`). The app does not automatically load `.env` files.

```sh
export PAPERLESS_URL='https://paperless.example.com/'
export PAPERLESS_TOKEN='your-paperless-api-token'
export APP_PASSWORD='a-long-random-password'
export APP_USERNAME='receipt'
node server.js
```

Open `http://127.0.0.1:3000` on the host computer. The browser asks for credentials; use the configured `APP_USERNAME` and `APP_PASSWORD`. If `APP_USERNAME` is unset, any username is accepted. To use it from your phone, bind to your network interface with `HOST=0.0.0.0` and make the app available through a trusted HTTPS reverse proxy or private VPN. Use HTTPS for remote access: HTTP Basic credentials and receipt images are otherwise transmitted unencrypted. Keep the service private; this simple app has one shared password and no rate limiting or account management. Your Paperless URL may include a path prefix. Keep the Paperless token and app password secret.

For Docker, pass the same variables through your deployment's secret management, set `HOST=0.0.0.0`, and publish port 3000 to a trusted HTTPS proxy. Avoid committing credentials to a repository.

```sh
docker build -t receipt-to-paperless .
docker run --rm --env PAPERLESS_URL --env PAPERLESS_TOKEN --env APP_PASSWORD --env APP_USERNAME -e HOST=0.0.0.0 -p 127.0.0.1:3000:3000 receipt-to-paperless
```

Choose **Take a photo** to use the phone camera, or select an existing image or PDF if your browser offers that choice. Add an optional title, review the preview, and send. Camera and file-picker behaviour depends on the device and browser. The maximum request size is 20 MiB. Paperless handles OCR and any subsequent classification. For photos, the app attempts to find a contrasting receipt and crop around it on your device. Review the preview and choose the original if the crop is wrong; detection works best with the whole receipt on a plain, contrasting background. PDFs are sent unchanged. Perspective correction is not supported.

## Development

`node --test` runs the integration checks with a local mock Paperless server. No third-party packages are required.

## Licence

MIT; see [LICENSE](LICENSE). This project is not affiliated with Paperless-ngx.
