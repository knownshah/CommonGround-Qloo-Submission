# CommonGround

CommonGround is a Qloo-powered group decision app. It helps 2–8 people turn different cultural favorites into shared options, compare each person's relative ranking, raise an objection, and explicitly agree on the current proposal.

Qloo grounds live discovery in cultural taste. CommonGround's decision rules and agreement flow make the trade-offs visible; rankings are relative to the shortlist and do not predict satisfaction.

## Run locally

Requires Node.js 24.14.0 (or Node.js 22.19.0 or newer) and npm.

```sh
npm ci --ignore-scripts
npm start
```

Open <http://127.0.0.1:3000>. The built-in examples use invented identities and scores and are labeled synthetic; they contain no Qloo API response data. You can explore the group-decision flow without an API key.

## Enable live Qloo discovery

Create a local `.env` from `.env.example` and set `QLOO_API_KEY` there, or set that variable in the server environment. The key is used only by the server; never place it in browser code, a URL, a screenshot, or a commit. Qloo access for this hackathon is described in the [Qloo developer guide](https://docs.qloo.com/reference/qloo-llm-hackathon-developer-guide#getting-your-api-key).

The default hackathon API endpoint is in `qloo-endpoint.env`. For hosting, configure `QLOO_API_KEY` as a secret environment variable on the server.

## Assistant integration

CommonGround includes optional local MCP tools for resolving inputs, comparing a group, and reconsidering a confirmed exclusion. To use them with a local assistant client, run the server on loopback with `COMMONGROUND_MCP=1`. The public web app does not expose an MCP endpoint.

## Hackathon submission

This repository contains the app source, required assets, run instructions, and open-source license for the [Qloo Agentic Hackathon](https://qloo.devpost.com/). The hackathon requires a functional, externally hosted demo and a public source repository with an open-source license. See the [official rules](https://qloo.devpost.com/rules).

## License and assets

Application code is licensed under [MIT](LICENSE). Third-party dependency and asset notices are in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); photo and font credits and licenses are in [web/assets/CREDITS.md](web/assets/CREDITS.md). These assets retain their own licenses.
