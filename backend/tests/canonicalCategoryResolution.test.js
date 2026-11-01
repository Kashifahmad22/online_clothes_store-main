import test from "node:test";
import assert from "node:assert/strict";
import { parseCatalogueQuery } from "../utils/catalogueQuery.js";
import {
    CANONICAL_CATEGORIES,
    PRODUCT_TYPES,
    canonicalCategoryClause,
    findSubCategory,
    resolveProductCategory,
    subCategoryClause
} from "../config/catalogueTaxonomy.js";

// Minimal evaluator for the Mongo operators the clause uses ($or, $in, $regex + $options).
const matches = (doc, clause) => {
    if (clause.$or) return clause.$or.some(part => matches(doc, part));
    if (clause.$and) return clause.$and.every(part => matches(doc, part));
    if (clause.$nor) return !clause.$nor.some(part => matches(doc, part));
    return Object.entries(clause).every(([field, condition]) => {
        const value = doc[field];
        if (condition.$in) return condition.$in.includes(value);
        if (condition.$regex) return typeof value === "string" && new RegExp(condition.$regex, condition.$options).test(value);
        return value === condition;
    });
};

const LABELS = [
    "Sarees", "saree", "SAREES", "  Silk   Sarees ", "cotton sarees", "Suit Piece", "suit pieces", "Suit Pants", "SUIT  PANTS",
    "Lehenga", "lehengas", "Kurti", "KURTIS", "Dupatta", "Lungis", "", "Sarees!", "Silk Sarees (Banarasi)"
];
const products = PRODUCT_TYPES.flatMap(productType => LABELS.map(category => ({ productType, category })));

test("canonicalCategory builds one $and clause and keeps the other filters", () => {
    const { filter } = parseCatalogueQuery({ canonicalCategory: "suit-pieces", search: "silk", fabric: "Cotton" });
    assert.equal(filter.status, "published");
    assert.equal(filter.$and.length, 1);
    assert.ok(filter.$or, "search $or is not overwritten");
    assert.ok(filter["details.fabric"]);
    assert.equal("category" in filter, false);
    assert.equal("productType" in filter, false);
});

test("canonicalCategory rejects unknown values, including legacy slugs", () => {
    for (const bad of ["suit-pants", "silk-sarees", "Sarees", "kurti", "other", "x"]) {
        assert.throws(() => parseCatalogueQuery({ canonicalCategory: bad }), { status: 400 }, bad);
    }
    assert.throws(() => parseCatalogueQuery({ canonicalCategory: " " }), { status: 400 });
});

test("the Mongo clause selects exactly the products resolveProductCategory assigns to the category", () => {
    for (const category of CANONICAL_CATEGORIES) {
        const clause = canonicalCategoryClause(category.id);
        for (const product of products) {
            assert.equal(matches(product, clause), resolveProductCategory(product).category?.id === category.id,
                `${category.id} <- ${product.productType}/${JSON.stringify(product.category)}`);
        }
    }
});

test("every product is matched by at most one canonical category, so lists never duplicate it", () => {
    for (const product of products) {
        const hits = CANONICAL_CATEGORIES.filter(category => matches(product, canonicalCategoryClause(category.id)));
        assert.ok(hits.length <= 1, `${product.productType}/${product.category}`);
    }
});

test("public category filtering for all four categories by productType", () => {
    const expected = {
        sarees: ["saree"], "suit-pieces": ["suit-piece", "suit", "suit-set"], lehengas: ["lehenga"], kurtis: ["kurti"]
    };
    for (const [id, types] of Object.entries(expected)) {
        const { filter } = parseCatalogueQuery({ canonicalCategory: id });
        const hit = PRODUCT_TYPES.filter(type => matches({ productType: type, category: "Whatever" }, filter.$and[0]));
        assert.deepEqual(hit, types, id);
    }
});

test("case and whitespace variants of legacy labels stay discoverable for unmapped types", () => {
    const clause = canonicalCategoryClause("suit-pieces");
    for (const label of ["Suit Pants", "suit pants", "  SUIT   PANTS  ", "Suit Piece", "suit pieces"]) {
        assert.equal(matches({ productType: "other", category: label }, clause), true, label);
    }
    assert.equal(matches({ productType: "other", category: "Suit Pantsx" }, clause), false);
    assert.equal(matches({ productType: "other", category: "My Suit Pants" }, clause), false);
});

test("productType wins over a conflicting label, and unknown labels are never forced into a category", () => {
    assert.equal(matches({ productType: "saree", category: "Lehenga" }, canonicalCategoryClause("lehengas")), false);
    assert.equal(matches({ productType: "saree", category: "Lehenga" }, canonicalCategoryClause("sarees")), true);
    assert.equal(matches({ productType: "lehenga", category: "Sarees" }, canonicalCategoryClause("sarees")), false);
    for (const category of CANONICAL_CATEGORIES) {
        assert.equal(matches({ productType: "other", category: "Dupatta" }, canonicalCategoryClause(category.id)), false);
        assert.equal(matches({ productType: "other", category: "" }, canonicalCategoryClause(category.id)), false);
    }
});

test("alias regex is static, anchored and escapes label characters", () => {
    for (const category of CANONICAL_CATEGORIES) {
        const [, legacy] = canonicalCategoryClause(category.id).$or;
        assert.match(legacy.category.$regex, /^\^\[[^\]]+\]\*\(\?:[\s\S]+\)\[[^\]]+\]\*\$$/);
        assert.equal(legacy.category.$options, "i");
    }
});

const SPACES = ["\u0020", "  ", "\t", "\u00a0", "\u00a0\u00a0", " \u00a0\t ", "\u2003", "\u202f", "\u3000", "\ufeff", "\u2028"];

test("generated patterns avoid ASCII-only \\s and spell out Unicode whitespace explicitly", () => {
    const patterns = [
        canonicalCategoryClause("suit-pieces").$or[1].category.$regex,
        subCategoryClause("Silk Sarees").$or[0].subCategory.$regex
    ];
    for (const pattern of patterns) {
        assert.equal(/\\s/.test(pattern), false, "no bare \\s");
        assert.ok(pattern.includes("\u00a0"), "NBSP is listed literally");
    }
});

test("resolver and generated clauses agree for space, tab and NBSP variants (JavaScript regex only)", () => {
    // This evaluates the generated pattern with JavaScript's RegExp. It does not prove MongoDB (PCRE) behaviour.
    for (const space of SPACES) {
        for (const label of [`${space}suit${space}pants${space}`, `silk${space}sarees`, `${space}Suit${space}Piece`]) {
            const expected = resolveProductCategory({ productType: "other", category: label }).category;
            assert.ok(expected, JSON.stringify(label));
            assert.equal(matches({ productType: "other", category: label }, canonicalCategoryClause(expected.id)), true, JSON.stringify(label));
        }
        assert.equal(matches({ category: `silk${space}sarees` }, subCategoryClause("Silk Sarees")), true);
        assert.equal(matches({ subCategory: `${space}Suit${space}Pants` }, subCategoryClause("Suit Pants")), true);
        assert.equal(findSubCategory(`suit${space}pants`)?.label, "Suit Pants", JSON.stringify(space));
    }
    // Words must still be separated, and zero-width or non-space characters are never treated as spaces.
    assert.equal(matches({ productType: "other", category: "suitpants" }, canonicalCategoryClause("suit-pieces")), false);
    assert.equal(matches({ productType: "other", category: "suit\u200bpants" }, canonicalCategoryClause("suit-pieces")), false);
    assert.equal(matches({ productType: "other", category: "suit-pants" }, canonicalCategoryClause("suit-pieces")), false);
    assert.equal(matches({ productType: "dress", category: "suit\u00a0pants" }, canonicalCategoryClause("suit-pieces")), false);
});

test("legacy suit and suit-set URLs combine productType with the parent category without widening", () => {
    for (const [type, other] of [["suit", "suit-set"], ["suit-set", "suit"]]) {
        const { filter } = parseCatalogueQuery({ canonicalCategory: "suit-pieces", productType: type });
        assert.equal(filter.productType, type);
        assert.equal(filter.$and.length, 1);
        const inScope = doc => (!filter.productType || doc.productType === filter.productType) && matchesFilter(doc, filter);
        assert.equal(inScope({ productType: type, category: "x" }), true);
        assert.equal(inScope({ productType: other, category: "x" }), false);
        assert.equal(inScope({ productType: "suit-piece", category: "x" }), false);
        assert.equal(inScope({ productType: "other", category: "Suit Pants" }), false);
    }
    assert.equal(parseCatalogueQuery({ productType: "suit" }).filter.productType, "suit");
    assert.throws(() => parseCatalogueQuery({ productType: "suits" }), { status: 400 });
});

test("resolveProductCategory: precedence, subcategory preservation and statuses", () => {
    const suit = resolveProductCategory({ productType: "suit-piece", category: "Suit Pants" });
    assert.deepEqual([suit.category.id, suit.source, suit.subCategory, suit.rawCategory, suit.conflict],
        ["suit-pieces", "productType", "Suit Pants", "Suit Pants", false]);
    const stored = resolveProductCategory({ productType: "saree", category: "Silk Sarees", subCategory: " Banarasi " });
    assert.equal(stored.subCategory, "Banarasi");
    const conflict = resolveProductCategory({ productType: "saree", category: "Suit Pants" });
    assert.equal(conflict.category.id, "sarees");
    assert.equal(conflict.conflict, true);
    assert.equal(conflict.subCategory, null);
    assert.equal(conflict.rawCategory, "Suit Pants");
    const legacy = resolveProductCategory({ productType: "other", category: " silk SAREES " });
    assert.deepEqual([legacy.category.id, legacy.source, legacy.subCategory], ["sarees", "label", "Silk Sarees"]);
    assert.deepEqual(
        [resolveProductCategory({ productType: "other", category: "Dupatta" }).category,
            resolveProductCategory({ productType: "other", category: "Dupatta" }).status],
        [null, "unclassified"]);
    assert.equal(resolveProductCategory({ productType: "dress", category: "Dresses" }).status, "unresolved");
    assert.equal(resolveProductCategory({ productType: "dress", category: "Kurti" }).category, null);
    assert.equal(resolveProductCategory({}).category, null);
    assert.equal(resolveProductCategory().category, null);
});

const matchesFilter = (doc, filter) => filter.$and.every(clause => matches(doc, clause));

test("subCategory is validated and always requires its own parent canonicalCategory", () => {
    const { filter } = parseCatalogueQuery({ canonicalCategory: "sarees", subCategory: " cotton   SAREES ", search: "red" });
    assert.equal(filter.$and.length, 2);
    assert.ok(filter.$or, "search $or is preserved");
    for (const query of [
        { subCategory: "Cotton Sarees" },
        { canonicalCategory: "suit-pieces", subCategory: "Cotton Sarees" },
        { canonicalCategory: "sarees", subCategory: "Suit Pants" },
        { canonicalCategory: "sarees", subCategory: "Banarasi" },
        { canonicalCategory: "sarees", subCategory: "Sarees" },
        { canonicalCategory: "sarees", subCategory: " " },
        { canonicalCategory: "sarees", subCategory: ["Silk Sarees"] }
    ]) {
        assert.throws(() => parseCatalogueQuery(query), { status: 400 }, JSON.stringify(query));
    }
    assert.equal(parseCatalogueQuery({ canonicalCategory: "suit-pieces", subCategory: "Suit Pants" }).filter.$and.length, 2);
});

test("subCategory narrows a category by legacy label or stored subCategory, and never leaks across parents", () => {
    const silk = parseCatalogueQuery({ canonicalCategory: "sarees", subCategory: "Silk Sarees" }).filter;
    const pants = parseCatalogueQuery({ canonicalCategory: "suit-pieces", subCategory: "Suit Pants" }).filter;
    const yes = [
        { productType: "saree", category: "Silk Sarees" },
        { productType: "saree", category: "  silk   SAREES " },
        { productType: "saree", category: "Sarees", subCategory: "Silk Sarees" },
        { productType: "other", category: "silk sarees" }
    ];
    const no = [
        { productType: "saree", category: "Cotton Sarees" },
        { productType: "saree", category: "Sarees" },
        { productType: "saree", category: "Silk Sarees Deluxe" },
        { productType: "lehenga", category: "Silk Sarees" },
        { productType: "dress", category: "Silk Sarees" },
        { productType: "other", category: "Dupatta", subCategory: "Banarasi" }
    ];
    for (const product of yes) assert.equal(matchesFilter(product, silk), true, JSON.stringify(product));
    for (const product of no) assert.equal(matchesFilter(product, silk), false, JSON.stringify(product));
    assert.equal(matchesFilter({ productType: "suit-piece", category: "Suit Pants" }, pants), true);
    assert.equal(matchesFilter({ productType: "other", category: " SUIT  PANTS " }, pants), true);
    assert.equal(matchesFilter({ productType: "suit-piece", category: "Suit Pieces" }, pants), false);
    assert.equal(matchesFilter({ productType: "dress", category: "Suit Pants" }, pants), false);
    assert.equal(matchesFilter({ productType: "saree", category: "Suit Pants" }, pants), false);
});

test("conflicting category label and subCategory resolve to exactly one subcategory (stored subCategory wins)", () => {
    const clauseFor = (parent, label) => parseCatalogueQuery({ canonicalCategory: parent, subCategory: label }).filter;
    const silk = clauseFor("sarees", "Silk Sarees");
    const cotton = clauseFor("sarees", "Cotton Sarees");
    const pants = clauseFor("suit-pieces", "Suit Pants");
    const cases = [
        [{ productType: "saree", category: "Cotton Sarees", subCategory: "Silk Sarees" }, { silk: true, cotton: false }],
        [{ productType: "saree", category: "Silk Sarees", subCategory: "Cotton Sarees" }, { silk: false, cotton: true }],
        [{ productType: "saree", category: " silk  SAREES ", subCategory: " COTTON sarees " }, { silk: false, cotton: true }],
        [{ productType: "saree", category: "Silk Sarees", subCategory: "Silk Sarees" }, { silk: true, cotton: false }],
        [{ productType: "saree", category: "Silk Sarees", subCategory: "Banarasi" }, { silk: true, cotton: false }],
        [{ productType: "saree", category: "Sarees", subCategory: "Cotton Sarees" }, { silk: false, cotton: true }],
        [{ productType: "other", category: "Silk Sarees", subCategory: "Cotton Sarees" }, { silk: false, cotton: true }],
        [{ productType: "saree", category: "Silk Sarees" }, { silk: true, cotton: false }]
    ];
    for (const [product, expected] of cases) {
        assert.equal(matchesFilter(product, silk), expected.silk, `silk <- ${JSON.stringify(product)}`);
        assert.equal(matchesFilter(product, cotton), expected.cotton, `cotton <- ${JSON.stringify(product)}`);
    }
});

test("Suit Pants conflicts never place a product on more than one subcategory page", () => {
    const parents = { "Silk Sarees": "sarees", "Cotton Sarees": "sarees", "Suit Pants": "suit-pieces" };
    const pages = Object.entries(parents).map(([label, parent]) =>
        parseCatalogueQuery({ canonicalCategory: parent, subCategory: label }).filter);
    const labels = ["", "Sarees", "Silk Sarees", "Cotton Sarees", "Suit Pants", "Suit Pieces", "Banarasi"];
    for (const productType of PRODUCT_TYPES) {
        for (const category of labels) {
            for (const subCategory of labels) {
                const product = { productType, category, ...(subCategory ? { subCategory } : {}) };
                const hits = pages.filter(filter => matchesFilter(product, filter)).length;
                assert.ok(hits <= 1, `${hits} subcategory pages <- ${JSON.stringify(product)}`);
            }
        }
    }
    const pantsPage = parseCatalogueQuery({ canonicalCategory: "suit-pieces", subCategory: "Suit Pants" }).filter;
    assert.equal(matchesFilter({ productType: "suit-piece", category: "Suit Pants", subCategory: "Silk Sarees" }, pantsPage), false);
    assert.equal(matchesFilter({ productType: "suit-piece", category: "Suit Pieces", subCategory: "Suit Pants" }, pantsPage), true);
    assert.equal(matchesFilter({ productType: "suit-piece", category: "Suit Pants", subCategory: "Banarasi" }, pantsPage), true);
});

test("dress stays unresolved whatever its label says, in the resolver and in every category query", () => {
    for (const label of ["Kurti", "Sarees", "Suit Pants", "Lehenga", "Silk Sarees", "Dresses", ""]) {
        const product = { productType: "dress", category: label, subCategory: " Anarkali " };
        const resolved = resolveProductCategory(product);
        assert.deepEqual([resolved.category, resolved.status, resolved.source], [null, "unresolved", null], label);
        assert.equal(resolved.rawCategory, label, "raw category preserved");
        assert.equal(resolved.subCategory, "Anarkali", "subCategory preserved");
        for (const category of CANONICAL_CATEGORIES) {
            assert.equal(matches(product, canonicalCategoryClause(category.id)), false, `${category.id} <- dress/${label}`);
        }
    }
});

test("other keeps legacy alias resolution, with subcategory", () => {
    assert.equal(resolveProductCategory({ productType: "other", category: "Kurti" }).category.id, "kurtis");
    const pants = resolveProductCategory({ productType: "other", category: "Suit Pants" });
    assert.deepEqual([pants.category.id, pants.subCategory, pants.source, pants.rawCategory],
        ["suit-pieces", "Suit Pants", "label", "Suit Pants"]);
    assert.equal(matches({ productType: "other", category: "kurti" }, canonicalCategoryClause("kurtis")), true);
    assert.equal(matches({ productType: "other", category: " SUIT  pants " }, canonicalCategoryClause("suit-pieces")), true);
});

test("the legacy-label fallback clause is limited to the other type", () => {
    for (const category of CANONICAL_CATEGORIES) {
        const [, legacy] = canonicalCategoryClause(category.id).$or;
        assert.deepEqual(legacy.productType, { $in: ["other"] });
    }
});

test("a known productType beats a conflicting label for every structural type", () => {
    const expected = { saree: "sarees", "suit-piece": "suit-pieces", suit: "suit-pieces", "suit-set": "suit-pieces", lehenga: "lehengas", kurti: "kurtis" };
    for (const [productType, id] of Object.entries(expected)) {
        for (const category of ["Kurti", "Sarees", "Suit Pants", "Lehenga"]) {
            const resolved = resolveProductCategory({ productType, category });
            assert.equal(resolved.category.id, id, `${productType}/${category}`);
            assert.equal(resolved.source, "productType");
        }
    }
});
