# BetaMovie

[![BetaMovie Image](.github/BetaMovie.png)](https://docs.pstream.mov)

## Quick Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FBetaMovie%2FBetaMovie)

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/BetaMovie/BetaMovie)

**NOTE: To self-host, more setup is required. Check the [docs](https://docs.pstream.mov) to properly set up!!!!**

## Links And Resources

| Service       | Link                                            | Source Code                                             |
| ------------- | ----------------------------------------------- | ------------------------------------------------------- |
| BetaMovie Docs | [docs](https://docs.pstream.mov)                | [source code](https://github.com/BetaMovie/docs)         |
| Extension     | [extension](https://docs.pstream.mov/extension) | [source code](https://github.com/BetaMovie/browser-ext)  |
| Proxy         | [simple-proxy](https://docs.pstream.mov/proxy)  | [source code](https://github.com/BetaMovie/simple-proxy) |
| Backend       | [backend](https://server.fifthwit.net)          | [source code](https://github.com/BetaMovie/backend)      |
| Frontend      | [BetaMovie](https://docs.pstream.mov/instances)  | [source code](https://github.com/BetaMovie/BetaMovie)     |
| Weblate       | [weblate](https://weblate.pstream.mov)          |                                                         |

**_I provide these if you are not able to host yourself, though I do encourage hosting the frontend._**

## Referrers

- [FMHY (Voted as #1 streaming site of 2024, 2025)](https://fmhy.net)

## Running Locally

Type the following commands into your terminal / command line to run BetaMovie locally

```bash
git clone https://github.com/BetaMovie/BetaMovie.git
cd smov
git pull
pnpm install
pnpm run dev
```

Then you can visit the local instance [here](http://localhost:5173) or, at local host on port 5173.

## Updating a BetaMovie Instance

To update a BetaMovie instance you can type the below commands into a terminal at the root of your project.

```bash
git remote add upstream https://github.com/BetaMovie/BetaMovie.git
git fetch upstream # Grab the contents of the new remote source
git checkout <YOUR_MAIN_BRANCH>  # Most likely this would be `origin/production`
git merge upstream/production
# * Fix any conflicts present during merge *
git add .  # Add all changes made during merge and conflict fixing
git commit -m "Update BetaMovie instance (merge upstream/production)"
git push  # Push to YOUR repository
```

## Contact Me / Fluxer

[Fluxer](https://fluxer.gg/rEBQ3B8E)

(Fluxer is an OSS Discord alternative platform)
