<!-- Thanks for contributing! Fill the sections that apply and delete the rest. -->

## What kind of change is this?

- [ ] 📊 Data update (merchants / test descriptors in `data/`)
- [ ] ✨ App feature
- [ ] 🐛 Fix
- [ ] 📝 Docs

## Summary

<!-- One or two sentences: what does this PR add or change, and why? -->

## Data changes (delete if not a data update)

| | ids |
|---|---|
| **Added merchants** | `merchant_id_1`, `merchant_id_2` |
| **Updated merchants** | — |
| **Deleted merchants** | — |
| **Test descriptors** | — |

**Counts:** merchants … → … · testDescriptors … → …

- [ ] Categories come from the taxonomy, aliases are lowercase/unaccented, no bare generic-word aliases
- [ ] Checked the **Validate** page (or ran `node scripts/apply-update.mjs`) — no integrity errors
- [ ] New merchants have at least one realistic statement alias (how it ACTUALLY appears on a bank statement)
- [ ] I agree this contribution is licensed under [CC BY 4.0](../data/LICENSE), same as the rest of `data/`

## App changes (delete if data-only)

<!-- What changed in src/, and why. -->

- [ ] `PAGES=1 npm run build` passes
- [ ] Test set still passes on the **Test set** page (285+/…)

## How was this PR created?

- [ ] Merchant Studio **⇪ Publish data** button
- [ ] By hand
