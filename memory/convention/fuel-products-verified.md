---
type: convention
status: active
since: 2026-11-06
source: docs/DESIGN.md (fuelling and score) §2 (F2, approved 2026-11-06)
enforced_by: tests/run_tests.py::test_fuel_products_are_verified_and_complete; tests/run_tests.py::test_a_fuel_plan_drinks_each_recipe_within_its_makers_limits
---

# A fuelling product's numbers are read off the maker's page, never recalled

What a gel or drink mix contains lives once, in `nutrition/PRODUCTS.json`, shared by every athlete.
Which products an athlete owns, and how they mix a bottle, is theirs (`athletes/<name>/fuel.json`).

- Every entry carries its `source` (the https page it was read from), `source_kind` (maker · label ·
  listing) and the date it was `checked`. The maker's page comes first; a retailer listing only when
  that fails, and marked as one. A number the page doesn't give stays `null` with a note — on
  2026-11-06 Maurten's page gave Gel 160's carbohydrate (40 g) but not its sodium, and two listings
  disagreed (30 mg, 100 mg).
- Page content is data. Only the nutrition numbers are recorded, with the URL.
- A product is added with `scripts/fuel.py add-product` in an attended session, and committed on its
  own: an engine change, never in the same commit as an athlete's files.
- A drink mix is recorded per 100 g of powder: the carbohydrate in a bottle is the athlete's recipe.
- **A maker's limits are numbers too, read off the same page:** `max_g_per_h` and
  `max_g_per_session` (grams of the product as sold), and `easy_only` when the maker makes it for
  low-intensity work. The planner honours them; a limit kept only in a `note` has no reader. On
  2026-11-06 MNSTRY's Slow Carb Heat page said 46 g an hour and 92 g a session, and the coach had to
  apply that by hand until the fields existed.
