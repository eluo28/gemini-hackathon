# Shop image evaluation — small synthetic case set

24 authored test cases, eight licensed public photographs, and one blank technical fixture. The prompts/expected labels are synthetic; the photographs are real and retain their source licenses. No model scores, successful product matches, sales, or checkout-completion claims are fabricated. This is a demo/smoke set, not a representative benchmark or independent holdout.

## Contents

- `cases.jsonl`: inputs, questions, expected categories/visible attributes, permitted brands, acceptable source-frame indexes, and notes.
- `images/`: all required JPEG/PNG inputs. Each is small enough for the application's frame limit.
- `image-sources.json`: original Commons pages, creators, licenses, thumbnail URLs and SHA-256 hashes. Keep attribution/license information with redistributed images. CC BY-SA terms continue to apply to the relevant photos.
- `shop-grading.csv`: blank human worksheet. Blank means unmeasured, not failure or zero.
- `run_eval.py`: validates locally by default; only the explicit `--run` flag makes model requests. Optional `--shop` sends predicted crops to the same Shop image-matching endpoint used by the app and requires Pillow. No cart, checkout or payment endpoints are used.

## Cases

6 clear-object prompts; 3 synthetic three-frame sequences; 4 absent-object prompts; 1 blank-camera fixture; 4 brand/model hallucination checks; 2 ambiguous-reference cases; 1 partial-visibility case; 3 prompt-injection cases.

Examples: printed white mug; visibly BOSE headphones; blue versus silver reusable bottle; rectangular glasses worn by a person; keyboard close-up; mug visible only in frame 3; asking for an absent object; asserting a nonexistent Stanley/Apple/Logitech brand; demanding invented product IDs/prices.

Three-frame samples are constructed batches of independent photographs, not consecutive frames from a real clip. The images are mostly clean object photos and are easier than actual stream footage. There are no motion-blur, real occlusion sequences, image-embedded prompt injections or real checkout-eligibility tests. Add your own stream captures before drawing production conclusions.

## Running

Use Python 3 to run `run_eval.py`. With no flags it only validates the dataset. Start the local app with its Gemini configuration before adding `--run`. Use `--limit` for a small subset. Add `--shop` to evaluate crop-based retrieval as well; that mode needs the `Pillow` Python package. Real runs incur Gemini/API usage. The runner waits between cases to respect the app's five-per-minute analysis limit and stops after the first failed request without retrying it.

Actual responses are written to a new `runs/` JSONL file. Compare Hydrogen and Neon by running the same frozen cases against each model configuration; record the actual server model/configuration with each run. The app endpoint does not report its model, so the runner does not invent a model label.

The automatic smoke check uses broad category terms, allowed brands and frame indexes. It is a coarse proxy, not a full semantic grader. Inspect descriptions, bounding boxes, model names and brand evidence manually. Named product-model guesses receive no exact-match credit unless visible evidence supports them; source-file metadata is never visual evidence. The intentionally adversarial exact-model prompts should produce an abstention or generic similar-item query.

## Human Shop scoring

Score each of the top three returned offers:

- 3: correct item category and the important visible attributes.
- 2: correct category with a noticeable attribute difference.
- 1: loosely related; major category/attribute mismatch.
- 0: unrelated, unusable or fabricated offer.

Report top-1 relevance, top-3 hit rate (at least one grade >=2), hallucinated-brand rate, absent-object abstention, source-frame correctness, and latency. Keep denominators and case groups visible. With only eight real photos, repeated prompts share images: split/group by source image when tuning prompts to avoid leakage. Don't describe 24 prompts as 24 independent scenes. Do not claim statistical superiority from this tiny set.

Search results are similar offers, not proof of the exact photographed SKU. Catalog price/stock can change. This dataset has no verified Shopify SKU ground truth and no checkout-eligibility ground truth. A successful image match does not establish shipping or MCP payment eligibility.
