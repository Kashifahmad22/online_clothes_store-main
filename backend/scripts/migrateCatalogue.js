import "dotenv/config";
import mongoose from "mongoose";
import productModel from "../models/productModel.js";
import productVariantModel from "../models/productVariantModel.js";
import userModel from "../models/userModel.js";

const apply = process.argv.includes("--apply");
const slugify = value => String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

const main = async () => {
    if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI must be configured before running the migration.");
    }

    await mongoose.connect(`${process.env.MONGODB_URI}/e-commerce`, { autoIndex: false });
    const products = await productModel.collection.find({
        productType: { $exists: false }
    }).toArray();
    let updatedProducts = 0;
    let createdVariants = 0;
    let migratedCarts = 0;

    console.log(`${apply ? "APPLY" : "DRY RUN"}: ${products.length} legacy product(s) found.`);

    for (const product of products) {
        const pricePaise = Number.isFinite(product.price)
            ? Math.round(product.price * 100)
            : null;
        if (!Number.isSafeInteger(pricePaise) || pricePaise < 0) {
            console.log(`SKIP ${product._id}: invalid legacy price; manual correction required.`);
            continue;
        }

        const productSlug = `${slugify(product.name) || "legacy-product"}-${product._id.toString().slice(-8)}`;
        const legacyImages = Array.isArray(product.image) ? product.image : [];
        const images = legacyImages
            .filter(url => typeof url === "string" && /^https:\/\//i.test(url))
            .map((url, order) => ({
                url,
                role: order === 0 ? "primary" : "other",
                altText: "",
                order
            }));
        const legacySizes = Array.isArray(product.sizes) ? product.sizes.filter(Boolean) : [];
        const variantOptions = legacySizes.length
            ? legacySizes.map(size => ({ size: String(size) }))
            : [{}];
        const variants = variantOptions.map((options, index) => {
            return {
                _id: new mongoose.Types.ObjectId(),
                productId: product._id,
                sku: `LEG-${product._id.toString()}-${index + 1}`.toUpperCase(),
                options,
                stockOnHand: 0,
                reserved: 0,
                lowStockThreshold: 2,
                active: true
            };
        });

        console.log(
            `${apply ? "MIGRATE" : "WOULD MIGRATE"} ${product._id}: ` +
            `${variants.length} SKU(s), ${images.length} image(s), draft/unavailable.`
        );
        const cartPath = `cartData.${product._id}`;
        const cartsToMigrate = await userModel.collection.countDocuments({
            [cartPath]: { $exists: true }
        });
        if (!apply) {
            migratedCarts += cartsToMigrate;
            continue;
        }

        const legacyData = {
            category: product.category,
            subCategory: product.subCategory,
            sizes: product.sizes,
            price: product.price,
            date: product.date,
            bestseller: product.bestseller
        };
        await productVariantModel.collection.bulkWrite(variants.map(variant => ({
            updateOne: {
                filter: { sku: variant.sku },
                update: { $setOnInsert: variant },
                upsert: true
            }
        })), { ordered: true });

        const storedVariants = await productVariantModel.collection
            .find({ productId: product._id }).toArray();
        const variantBySize = new Map(legacySizes.map((size, index) => {
            const sku = `LEG-${product._id.toString()}-${index + 1}`.toUpperCase();
            return [String(size), storedVariants.find(variant => variant.sku === sku)?._id];
        }));
        const users = await userModel.collection.find({
            [cartPath]: { $exists: true }
        }, {
            projection: { _id: 1, [cartPath]: 1 }
        }).toArray();
        for (const user of users) {
            const existing = user.cartData?.[product._id.toString()];
            if (!existing || typeof existing !== "object") continue;
            const migrated = {};
            for (const [oldKey, quantity] of Object.entries(existing)) {
                const variantId = variantBySize.get(oldKey);
                if (variantId && Number.isSafeInteger(quantity) && quantity > 0) {
                    migrated[variantId.toString()] = quantity;
                }
            }
            await userModel.collection.updateOne(
                { _id: user._id },
                { $set: { [`cartData.${product._id}`]: migrated } }
            );
            migratedCarts += 1;
        }

        const result = await productModel.collection.updateOne(
            { _id: product._id, productType: { $exists: false } },
            {
                $set: {
                    slug: productSlug,
                    productType: "other",
                    category: product.category || "Legacy",
                    subCategory: product.subCategory || "",
                    pricePaise,
                    images,
                    details: {},
                    status: "draft",
                    bestseller: product.bestseller === true,
                    legacyData,
                    updatedAt: new Date()
                },
                $unset: { image: "", price: "", sizes: "", date: "" }
            }
        );
        if (result.modifiedCount === 1) {
            updatedProducts += 1;
            createdVariants += variants.length;
        }
    }

    console.log(
        `${apply ? "Completed" : "Dry run complete"}: ${updatedProducts} product(s), ` +
        `${createdVariants} SKU(s), ${migratedCarts} cart(s) ${apply ? "updated" : "would be updated"}.`
    );
    if (!apply) {
        console.log("Review the report, back up MongoDB, then rerun with --apply to write changes.");
    }
};

main()
    .catch(error => {
        console.error("Catalogue migration failed:", { name: error.name || "Error" });
        process.exitCode = 1;
    })
    .finally(async () => mongoose.disconnect());
