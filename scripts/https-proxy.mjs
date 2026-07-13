import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

const certPath = process.env.LOCAL_HTTPS_PFX_PATH
  ? path.resolve(process.env.LOCAL_HTTPS_PFX_PATH)
  : path.join(rootDir, ".certs", "guided-body-reconstruction-local.pfx");

const passphrase = process.env.LOCAL_HTTPS_PFX_PASSPHRASE ?? "guided-body-reconstruction";
const port = Number(process.env.HTTPS_PORT ?? 3443);
const host = process.env.HTTPS_HOST ?? "0.0.0.0";
const targetOrigin = process.env.HTTP_TARGET_ORIGIN ?? "http://127.0.0.1:3000";
const target = new URL(targetOrigin);

if (!fs.existsSync(certPath)) {
  console.error(`Missing HTTPS certificate: ${certPath}`);
  console.error("Run scripts/create-local-https-cert.ps1 first.");
  process.exit(1);
}

const server = https.createServer(
  {
    pfx: fs.readFileSync(certPath),
    passphrase,
  },
  (clientRequest, clientResponse) => {
    const targetPath = clientRequest.url ?? "/";
    const requestHeaders = {
      ...clientRequest.headers,
      host: target.host,
      "x-forwarded-host": clientRequest.headers.host ?? "",
      "x-forwarded-proto": "https",
    };

    const proxyRequest = http.request(
      {
        hostname: target.hostname,
        port: target.port,
        protocol: target.protocol,
        method: clientRequest.method,
        path: targetPath,
        headers: requestHeaders,
      },
      (proxyResponse) => {
        clientResponse.writeHead(proxyResponse.statusCode ?? 502, proxyResponse.headers);
        proxyResponse.pipe(clientResponse);
      },
    );

    proxyRequest.on("error", (error) => {
      clientResponse.writeHead(502, { "content-type": "text/plain; charset=utf-8" });
      clientResponse.end(
        `Local HTTPS proxy could not reach ${targetOrigin}.\n\n${error.message}\n`,
      );
    });

    clientRequest.pipe(proxyRequest);
  },
);

server.listen(port, host, () => {
  console.log(`Local HTTPS proxy: https://0.0.0.0:${port}`);
  console.log(`Forwarding to: ${targetOrigin}`);
});
