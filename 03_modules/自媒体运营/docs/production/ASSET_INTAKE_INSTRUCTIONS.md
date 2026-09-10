# A2/B3 Asset Intake Instructions

You do not need to edit a database or understand Asset IDs.

## 1. Generate and inspect

- Use the prompts in `A2_VISUAL_PRODUCTION_PACKET.md` or
  `B3_VISUAL_PRODUCTION_PACKET.md` in a normal human-controlled ChatGPT image
  conversation.
- Download the original-resolution output.
- Rename it to the recommended filename.
- Inspect it yourself. B3 text must be checked character by character.

## 2. Keep or place the files

You may keep the downloaded file anywhere in this Creator Ops module and submit
its absolute local path. For convenience, copy it into:

```text
runtime/asset-intake/A2-20260714-001/incoming/
runtime/asset-intake/B3-20260714-001/incoming/
```

Do not place files in `source_import`. The intake API never overwrites or moves
your original.

## 3. Submit through CreatorOpsApplication

```python
from datetime import datetime, timezone
from creator_ops.api.application import create_creator_ops_application

app = create_creator_ops_application()
app.open()
result = app.submit_asset(
    "A2-20260714-001",
    "A2-20260714-001-VIDEO-COVER",
    r"<PROJECT_ROOT>\03_modules\自媒体运营\runtime\asset-intake\A2-20260714-001\incoming\A2-20260714-001_video-cover.png",
    now=datetime.now(timezone.utc),
)
app.close()
```

Replace the Content ID, requirement ID and path for each file. Retrieve exact IDs
with `app.get_asset_requirements(content_id)`.

## 4. Complete human visual review

Successful validation returns `PENDING_HUMAN_VISUAL_REVIEW`. Obtain the checklist:

```python
workbench = app.get_visual_review_workbench(result.data.submission_id)
```

Review every item. Only if all eleven items truly pass, call
`review_visual_asset(... decision="APPROVE", human_confirmation=True)`. Otherwise
choose `REJECT` or `REQUEST_CHANGE`. Codex will not approve the look for you.

## 5. Finish the content set

- A2 requires all 4 approved images.
- B3 requires all 6 approved cards.

Once all requirements are `VERIFIED`, call
`continue_visual_asset_pipeline(...)`. It rebuilds the local package and runs
Content, Asset, Package, Visual and Publish Prep QA. It does not publish. The
separate editorial review still must be approved before `READY_TO_PUBLISH`.

If a submission was interrupted, run
`app.recover_visual_asset_intake(now=...)`; staging residue is cleared and missing
managed files are surfaced as `RECOVERY_REQUIRED`.
