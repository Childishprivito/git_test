#!/usr/bin/env python3
"""Build assets/foods/usda.json, the app's built-in food database.

Source: USDA FoodData Central (public domain), "Foundation Foods" and
"SR Legacy" CSV downloads from https://fdc.nal.usda.gov/download-datasets

    python3 scripts/build-food-db.py <foundation_csv_dir> <sr_legacy_csv_dir>

Each directory is an unzipped download (has food.csv, food_nutrient.csv,
food_portion.csv, measure_unit.csv, food_category.csv). Output rows are
[fdcId, name, kcal, protein, carbs, fat, servingG, servingLabel], per 100 g.
"""
import csv
import json
import os
import re
import sys
from datetime import date

KCAL = ("1008", "2047", "2048")  # Energy (kcal); Atwater general / specific (Foundation)
KJ = "1062"
PROTEIN = "1003"
FAT = "1004"
CARBS = ("1005", "1050")  # by difference; by summation
SKIP_CATEGORIES = {"Baby Foods"}


def rows(path):
    with open(path, newline="", encoding="utf-8") as f:
        yield from csv.DictReader(f)


def load(folder, data_type):
    cats = {r["id"]: r["description"] for r in rows(os.path.join(folder, "food_category.csv"))}
    foods = {}
    for r in rows(os.path.join(folder, "food.csv")):
        if r["data_type"] != data_type:
            continue
        if cats.get(r["food_category_id"], "") in SKIP_CATEGORIES:
            continue
        foods[r["fdc_id"]] = {"name": r["description"].strip(), "n": {}}
    for r in rows(os.path.join(folder, "food_nutrient.csv")):
        f = foods.get(r["fdc_id"])
        if f is not None and r["amount"]:
            f["n"].setdefault(r["nutrient_id"], float(r["amount"]))
    units = {r["id"]: r["name"] for r in rows(os.path.join(folder, "measure_unit.csv"))}
    portions = {}
    for r in rows(os.path.join(folder, "food_portion.csv")):
        if r["fdc_id"] in foods and r["gram_weight"]:
            portions.setdefault(r["fdc_id"], []).append(r)
    out = []
    for fid, f in foods.items():
        n = f["n"]
        kcal = next((n[k] for k in KCAL if k in n), None)
        if kcal is None and KJ in n:
            kcal = n[KJ] / 4.184
        if kcal is None:
            continue
        carbs = next((n[k] for k in CARBS if k in n), 0.0)
        serving_g, label = None, None
        ps = sorted(portions.get(fid, []), key=lambda r: int(r["seq_num"] or 0))
        if ps:
            p = ps[0]
            serving_g = round(float(p["gram_weight"]), 1)
            amount = p["amount"] and float(p["amount"])
            unit = units.get(p["measure_unit_id"], "")
            unit = "" if unit in ("undetermined", "") else unit
            desc = (p["portion_description"] or "").strip()
            mod = (p["modifier"] or "").strip()
            if desc and desc.lower() != "quantity not specified":
                label = desc
            else:
                parts = [f"{amount:g}" if amount else "", unit, mod]
                label = " ".join(x for x in parts if x) or None
            if label and re.fullmatch(r"[\d.]+", label):
                label = None
        out.append([int(fid), f["name"], round(kcal, 1), round(n.get(PROTEIN, 0.0), 1),
                    round(carbs, 1), round(n.get(FAT, 0.0), 1), serving_g, label])
    return out


def main():
    foundation, legacy = sys.argv[1], sys.argv[2]
    a = load(foundation, "foundation_food")
    b = load(legacy, "sr_legacy_food")
    seen = {r[1].lower() for r in a}
    foods = a + [r for r in b if r[1].lower() not in seen]
    foods.sort(key=lambda r: r[1].lower())
    here = os.path.dirname(os.path.abspath(__file__))
    dest = os.path.join(here, "..", "assets", "foods", "usda.json")
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    with open(dest, "w", encoding="utf-8") as f:
        json.dump({
            "source": "USDA FoodData Central: Foundation Foods + SR Legacy (public domain)",
            "built": date.today().isoformat(),
            "columns": ["fdcId", "name", "kcal", "protein", "carbs", "fat", "servingG", "servingLabel"],
            "foods": foods,
        }, f, separators=(",", ":"), ensure_ascii=False)
    print(f"{len(a)} foundation + {len(foods) - len(a)} SR legacy = {len(foods)} foods, "
          f"{os.path.getsize(dest) / 1e6:.1f} MB -> {dest}")


if __name__ == "__main__":
    main()
