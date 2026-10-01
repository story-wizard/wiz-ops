# Find a Wizard build

In **Run tests**, choose **Find a build…** beside Build. Picking a build updates New run; the course starts only when you press Start.

## GitHub

Athanor uses the testing Mac's existing `gh` authentication to read `story-wizard/wizard-release`. Run `gh auth status` if lookup fails. No credentials go into the dashboard or workspace.

The finder fetches GitHub release records in batches of 50 and lists their published macOS ZIP assets. It groups them as Releases, Nightlies, then Tagged builds, newest publication first within each group. Version tags, `story-weekly-*` tags and `release-*` tags count as Releases; `nightly-*` tags count as Nightlies; other tags count as Tagged builds. Drafts and Windows packages are excluded. The release flag alone does not distinguish official releases from feature builds.

Search the entire retained catalog by build name, tag, branch or recorded PR number. Filters apply before pagination. The table starts at 50 builds per page; Show offers 25, 50, 100, 250 or All cached builds. Load 50 older from GitHub extends the catalog without downloading packages. Filter by channel, PR author, architecture, download status and publication date. PR author supports several GitHub users; Mine selects the currently authenticated GitHub account. Saved views include that selection. Architecture comes from the asset name; Unspecified means the name provides no architecture. Refresh checks GitHub for changes. Named saved filters and the last view stay in this browser.

PR author comes from the PRs referenced by the build tag and recorded release notes. The finder resolves each PR through GitHub and stores its author and link. A build can have several authors across components; selecting any one of them matches the build once. The workflow requester and publishing account remain separate metadata. The CLI returns `prAuthors`, `pullRequests`, `authorStatus`, `requestedBy`, `buildRunId` and `buildEvent` for agent filtering.

Build metadata is retained outside Git. Opening the finder reuses the catalog for five minutes; Refresh sends conditional GitHub requests and retrieves only changed responses. PR authors are reused for a day. Historical builds and consumer annotations survive refresh, and cached metadata remains available if GitHub is unavailable. See [shared build catalog](shared-build-catalog.md) for Tower/tool consumption and cache paths.

**Download & use** downloads the chosen asset, validates its ZIP, extracts one Wizard app into the external workspace, and selects it. **Use build** reuses an existing download. Imported builds also appear under **On this Mac** and in the Build selector.

## URL, tag, ZIP or app path

Use the third finder tab for:

- An exact GitHub release tag, including tags outside the recent listing.
- An HTTPS ZIP URL. Wizard release URLs use GitHub authentication; other URLs use an ordinary HTTPS download without GitHub credentials.
- An absolute path to a local `.zip` or `Wizard.app`.
- A ZIP chosen with the file picker.

Local app paths register the existing app without copying or modifying it. ZIPs and downloads go under `SMOKE_DATA_DIR/builds/`. The importer rejects unsafe archive paths and escaping or cyclic symbolic links, caps archives at 5 GB and expanded contents at 20 GB, and checks the bundle's Wizard executable. GitHub downloads verify asset size and the published SHA-256 digest when present. The normal preparation step still checks the package's exact schema, hashes and course prerequisites.

ZIP import requires Python 3 for standard-library archive inspection and macOS `ditto` for extraction. GitHub lookup/download also requires `gh`; direct URLs use macOS `curl`. Install these prerequisites through your normal workstation setup.

## Agent commands

Run from `smoke/` with the local service running. Replace URL with its printed loopback address:

```sh
node scripts/smoke.mjs builds --server URL
node scripts/smoke.mjs builds --author me --page 2 --server URL
node scripts/smoke.mjs builds --page-size all --server URL
node scripts/smoke.mjs builds --github-page 2 --server URL
node scripts/smoke.mjs builds --author charrisIII,gianni-rosato --refresh --server URL
node scripts/smoke.mjs build --tag nightly-YYYY.MM.DD-SHA --server URL
node scripts/smoke.mjs build --asset ASSET_ID --server URL
node scripts/smoke.mjs build --url https://example.com/Wizard-macOS.zip --server URL
node scripts/smoke.mjs build --path /absolute/path/to/Wizard.zip --server URL
node scripts/smoke.mjs build --path /Applications/Wizard.app --server URL
```

`builds` returns a filtered page with names, tags, asset identities, dates and cached app paths. Use `--page`, `--page-size` (1–500 or `all`) and `--author` to select records. The response includes `total`, `matching`, `page`, `pageSize`, `pageCount`, author facets, `nextGitHubPage` and `hasMoreGitHub`. `--github-page` loads a provider page into retained history; it is separate from the display page. `build` accepts exactly one source and returns the selected absolute app path and import metadata. Pass `result.app` to `plan --app`; importing does not launch Wizard or run a course.

The HTTP equivalents are `GET /api/builds` (cached) or `GET /api/builds?refresh=1` (refresh), `POST /api/builds/import` with one of `tag`, `assetId`, `url` or `path`, and `POST /api/builds/archive` with an `application/zip` body. One import runs at a time. A lost response needs inspection of setup and the external builds directory before another import; never infer that the subsequent test started.
