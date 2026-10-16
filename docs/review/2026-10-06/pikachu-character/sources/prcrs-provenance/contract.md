# Pikachu PRC fixture: focused provenance review

The fixture's identity and bytes are documented. Its original game patch, extractor, extraction method and unmodified game origin remain unknown. This review does not qualify production specials or change the existing numerical evidence.

The [original addition commit](https://github.com/ultimate-research/prc-rs/commit/b5f52320a545507f317924b2657d8a4b5a599ad7) added `src/tests/vl.prc` on 2022-10-12 alongside a typed-reading implementation and test. GitHub identifies the contributor as Benjamin Hall, login `benhall-7`; the pinned Cargo manifest also lists that contributor among the library authors. Contributor identity does not identify the person who originally extracted the game resource.

The [original test](https://github.com/ultimate-research/prc-rs/blob/b5f52320a545507f317924b2657d8a4b5a599ad7/src/tests/mod.rs) explicitly names the binary `FIGHTER_PIKACHU_VL`. It reads movement contact and hit-data structures and checks successful parsing. It supplies no game patch, extraction tool, original archive path, extraction date or claim that the bytes are an unmodified game dump. The commit date is the publication date of this repository change, not a proven extraction date.

The retained 6,385-byte fixture has SHA-256 `49a645b4e1833bb29f608b8d0b40eaff25c2e47750f0782a32355137f2af6b05`. Recomputing its Git blob hash gives `9e25029ee4c423e435716595b1a7bff23aaae00d`, exactly the binary blob recorded by the original addition. The earlier acquisition independently compared the original-addition bytes with the pinned later fixture and found them identical. This establishes byte continuity between those repository revisions, without establishing game provenance.

The focused public metadata review found:

- No pull request associated with the addition commit, and no comments on that commit, in the captured GitHub API responses.
- One commit in the current history of `src/tests/vl.prc`, matching its original addition.
- Eight repository pull requests and twelve combined issue/pull-request entries. Their captured bodies and the sole listed issue comment concern parser features or errors; none documents the Pikachu fixture's extraction or game patch.
- Two GitHub releases, both published in April 2020 and concerning `param-xml`, before the October 2022 fixture addition. The original Cargo library version `1.4.0` is a software package version, not a game patch identifier.
- No extraction or patch statement in the original and subsequent README captures, original test and manifest, addition metadata, or inspected commit messages across all 104 commits in the pinned ancestry.

The older [2019 accidental test-file removal](https://github.com/ultimate-research/prc-rs/commit/b6a068a32a889f6fe9c31cde5b258f81842d7d6b) refers to root `test.prc`, added in the preceding change. That binary is 1,431,816 bytes, Git blob `9d157888d2c6c16b04920f91640d060b88fff856`, SHA-256 `da3ad5260a39f7eab936df9ed9da5edf386deb539cf6c4ac74bbc88cb6711fb1`. It is not byte-identical to the Pikachu fixture. No semantic lineage or game identity is inferred from it; its unrelated binary is not added to this evidence directory.

These are bounded findings from captured public primary records. They do not prove that additional extraction information never existed. No author was contacted. An optional crates.io metadata request returned HTTP 403 and contributes no evidence.

`evidence.json` records the exact queries, hashes and retained raw responses under `captures/`. Existing 78/78 scalar matches at native storage precision remain valid as fixture comparisons. They cannot date the fixture, prove a vanilla extraction, or make the historical sheet an independent capture. Patch and extraction qualification fields remain unresolved.
