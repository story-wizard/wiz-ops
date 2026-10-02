# Shared build catalog

Athanor retains a versioned build catalog and GitHub response cache outside Git. Tower and other local tools can read the same file or consume the local API. The catalog describes builds; local test results and downloaded-app paths remain separate.

## Location

The default is `SMOKE_DATA_DIR/build-catalog/catalog.json`. Set `WIZARD_BUILD_CATALOG_DIR` to an absolute directory outside Git when several tools share it. Start every catalog-owning service with the same setting. For example:

```sh
export WIZARD_BUILD_CATALOG_DIR="$HOME/Library/Application Support/WizardSmoke/workspace/build-catalog"
npm run open
```

`GET /api/builds` returns a 10-build page of the catalog with the viewer's GitHub login and this workstation's available app paths. `GET /api/builds?refresh=1` refreshes it. Agents use `node scripts/smoke.mjs builds --server URL`. `builds --author me` selects the connected user’s PR builds; pass comma-separated logins for several authors. Add `--refresh` to request a conditional refresh. A five-minute warm catalog needs no build/PR downloads; resolving the current viewer still uses GitHub's user endpoint.

Filters search the whole retained catalog before display pagination. API query parameters are `page` (default 1), `pageSize` (default 10; 1–500 or `all`), repeated `author`/`channel`/`architecture`/`availability`, `search` and `since`. `author=me` uses the authenticated viewer. Within a filter selections are OR; different filters are AND. The response includes `total`, `matching`, `page`, `pageSize`, `pageCount` and `facets.authors`. `githubPage` fetches an older provider page in batches of 10; use `nextGitHubPage`/`hasMoreGitHub` to walk history. All cached builds does not fetch more GitHub pages.

The shared file has format `wizard-build-catalog/v1`, repository, refresh time, sync counts and a `builds` array. Entries are keyed by the GitHub asset ID within the recorded repository.

| Field | Meaning |
| --- | --- |
| `assetId`, `asset`, `bytes`, `expectedDigest`, `url` | Published package identity and download metadata |
| `tag`, `label`, `channel`, `publishedAt`, `architecture` | Build discovery fields |
| `pullRequests` | Component repository, PR number, author and PR URL |
| `prAuthors` | Deduplicated authors of the referenced PRs |
| `authorStatus` | Complete, Partial or Unknown attribution |
| `requestedBy`, `buildRunId`, `buildEvent`, `buildRunUrl` | Exact workflow requester and execution link when recorded |
| `publisher` | Account that published the GitHub release |
| `releaseNotes` | Retained source used to resolve recorded PR references |
| `listedRecently` | Whether the build appeared in the latest bounded release query |
| `annotations` | Optional consumer metadata preserved when Athanor refreshes that asset |

The PR author filter matches any selected author; a mixed-author build appears once per package. PR references come from explicit component PR numbers in the tag and PR links in release notes. Missing references or unavailable PR records yield Partial/Unknown attribution. Workflow requesters, bots and commit authors do not replace missing PR authors.

## Refresh and sharing

The first refresh reads up to 10 release records and 10 build-workflow records, resolves their PR references, and writes the catalog. Load older requests the next 10 release records. Later refreshes merge newly observed assets into retained history; older entries and their annotations stay available.

The `github/` directory holds endpoint, ETag, response body and check time. Conditional requests reuse unchanged responses on HTTP 304. PR author records are reused for a day and revalidated afterward. A failed refresh retains the prior catalog. The response's `sync` counts distinguish changed responses, unchanged responses and reused author records.

Files are published through atomic rename. One Athanor process owns refresh while other tools read its API or shared file. A catalog writer can add an asset’s namespaced annotations; those annotations survive subsequent refreshes. Coordinate writer ownership for refresh and annotation updates so concurrent writers do not overwrite each other. This change defines the consumption contract; it does not modify Tower.

The catalog stores no GitHub credentials, authenticated viewer identity, machine-local app paths or smoke results. It contains private repository metadata, so keep it in the team's intended local storage. Package validation and course preparation still happen when a build is selected for testing.
