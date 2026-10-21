"""Baut die Liste der meistgescannten Markenprodukte in Deutschland aus Open Food Facts.

Quelle: täglicher CSV-Export von Open Food Facts (ODbL), rund 1,2 GB gezippt, wird am Stück gelesen.
Aufruf:  pip install duckdb
         python -I scripts/build-off-foods.py public/off-foods.json [Anzahl, Standard 30000] [lokale products.csv.gz]
"""
import html
import json
import sys
import time

import duckdb

URL = 'https://static.openfoodfacts.org/data/en.openfoodfacts.org.products.csv.gz'


def main(target, limit=30000, source=URL):
    start = time.time()
    con = duckdb.connect()
    if source.startswith('http'):
        con.execute('INSTALL httpfs; LOAD httpfs;')
    rows = con.execute(f"""
        WITH raw AS (
          SELECT * FROM read_csv('{source}', delim = '\t', quote = '', escape = '', header = true, all_varchar = true,
                                 ignore_errors = true, null_padding = true, strict_mode = false, max_line_size = 10000000)
        ), products AS (
          SELECT
            trim(product_name) AS name,
            trim(split_part(coalesce(brands_en, ''), ',', 1)) AS brand,
            try_cast("energy-kcal_100g" AS DOUBLE) AS kcal,
            try_cast(proteins_100g AS DOUBLE) AS protein,
            try_cast(carbohydrates_100g AS DOUBLE) AS carbs,
            try_cast(fat_100g AS DOUBLE) AS fat,
            regexp_matches(coalesce(quantity, ''), '\\d\\s*(ml|cl|l)\\b', 'i') AS liquid,
            -- Scans zählen weltweit; Produkte nur für Deutschland (oder DACH) zählen mehr als Exportware aus Frankreich.
            try_cast(unique_scans_n AS INTEGER) * CASE
              WHEN countries_tags = 'en:germany' THEN 4
              WHEN len(string_split(countries_tags, ',')) <= 3 AND countries_tags NOT LIKE '%en:france%' THEN 2
              ELSE 1 END AS scans
          FROM raw
          WHERE countries_tags LIKE '%en:germany%'
        )
        SELECT name, brand, kcal, protein, carbs, fat, liquid
        FROM products
        WHERE scans >= 2 AND name IS NOT NULL AND length(name) BETWEEN 2 AND 80
          AND kcal BETWEEN 0 AND 1000 AND protein BETWEEN 0 AND 100 AND carbs BETWEEN 0 AND 100 AND fat BETWEEN 0 AND 100
        -- gleiche Produkte in mehreren Packungsgrößen nur einmal, das meistgescannte
        QUALIFY row_number() OVER (PARTITION BY lower(name), lower(brand) ORDER BY scans DESC) = 1
        ORDER BY scans DESC
        LIMIT {int(limit)}
    """).fetchall()
    foods = [[html.unescape(name), html.unescape(brand), round(kcal), round(protein, 1), round(carbs, 1), round(fat, 1), 1 if liquid else 0]
             for name, brand, kcal, protein, carbs, fat, liquid in rows]
    data = {'source': 'Open Food Facts (ODbL), meistgescannte Produkte in Deutschland', 'built': time.strftime('%Y-%m-%d'),
            'fields': ['name', 'brand', 'kcal', 'protein', 'carbs', 'fat', 'liquid'], 'foods': foods}
    with open(target, 'w', encoding='utf-8') as file:
        json.dump(data, file, ensure_ascii=False, separators=(',', ':'))
    print(f'{len(foods)} Produkte geschrieben in {round(time.time() - start)} s.')


if __name__ == '__main__':
    main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 30000, sys.argv[3] if len(sys.argv) > 3 else URL)
