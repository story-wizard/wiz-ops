# Find a Wizard build

In **Run tests**, choose **Find a build…** beside Build. Picking a build updates New run; the course starts only when you press Start.

## GitHub

Athanor uses the testing Mac's existing `gh` authentication to read `story-wizard/wizard-release`. Run `gh auth status` if lookup fails. No credentials go into the dashboard or workspace.

The finder reads up to 300 recent GitHub release records and lists their published macOS ZIP assets. It groups them as Releases, Nightlies, then Tagged builds, newest publication first within each group. Version tags, `story-weekly-*` tags and `release-*` tags count as Releases; `nightly-*` tags count as Nightlies; other tags count as Tagged builds. Drafts and Windows packages are excluded. The release flag alone does not distinguish official releases from feature builds.

Search by build name, tag, branch or a PR number present in those names. Filter by channel, architecture, download status and publication date. Architecture comes from the asset name; Unspecified means the name provides no architecture. Refresh reads GitHub again. Named saved filters and the last view stay in this browser.

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
node scripts/smoke.mjs build --tag nightly-YYYY.MM.DD-SHA --server URL
node scripts/smoke.mjs build --asset ASSET_ID --server URL
node scripts/smoke.mjs build --url https://example.com/Wizard-macOS.zip --server URL
node scripts/smoke.mjs build --path /absolute/path/to/Wizard.zip --server URL
node scripts/smoke.mjs build --path /Applications/Wizard.app --server URL
```

`builds` returns the ordered catalog with names, tags, asset identities, dates and cached app paths. Agents can filter that JSON themselves. `build` accepts exactly one source and returns the selected absolute app path and import metadata. Pass `result.app` to `plan --app`; importing does not launch Wizard or run a course.

The HTTP equivalents are `GET /api/builds`, `POST /api/builds/import` with one of `tag`, `assetId`, `url` or `path`, and `POST /api/builds/archive` with an `application/zip` body. One import runs at a time. A lost response needs inspection of setup and the external builds directory before another import; never infer that the subsequent test started.
