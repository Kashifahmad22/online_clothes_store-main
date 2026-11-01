import { createContext, useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import { toast } from "react-toastify";
import { useNavigate } from "react-router-dom";
import axios from 'axios'
import { availableQuantity, isVariantAvailable } from "../utils/productDisplay";
import { defaultSiteSettings } from "../config/siteSettings";
import { clearGuestCart, loadGuestCart, mergeCarts, reconcileGuestCart, saveGuestCart } from "../utils/guestCart";

export const ShopContext = createContext();

const readStoredToken = () => {
    try {
        return localStorage.getItem('token') || '';
    } catch {
        return '';
    }
}

const ShopContextProvider = (props) => {

    const currency = '₹ ';
    const backendUrl = import.meta.env.VITE_BACKEND_URL
    const [search, setSearch] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [token, setToken] = useState(readStoredToken)
    // A signed-in cart always comes from the server; only guests restore the locally persisted cart.
    const [cartItems, setCartItems] = useState(() => readStoredToken() ? {} : loadGuestCart());
    const [products, setProducts] = useState([]);
    const [productsLoading, setProductsLoading] = useState(true);
    const [productsError, setProductsError] = useState('');
    const [siteSettings, setSiteSettings] = useState(defaultSiteSettings);
    const [siteSettingsError, setSiteSettingsError] = useState('');
    const [siteSettingsLoaded, setSiteSettingsLoaded] = useState(false);
    const guestCartRef = useRef(loadGuestCart());
    const productsRef = useRef([]);
    const navigate = useNavigate();


    const addToCart = async (itemId, variantId) => {

        if (!variantId) {
            toast.error('Select an available SKU');
            return false;
        }

        const product = products.find(item => item._id === itemId);
        const variant = product?.variants?.find(item => item._id === variantId);
        if (!isVariantAvailable(variant)) {
            toast.error('This product option is currently unavailable.');
            return false;
        }
        const currentQuantity = cartItems[itemId]?.[variantId] || 0;
        if (currentQuantity >= availableQuantity(variant)) {
            toast.error('There is not enough stock available for that quantity.');
            return false;
        }

        const cartData = structuredClone(cartItems);
        if (cartData[itemId]) {
            if (cartData[itemId][variantId]) {
                cartData[itemId][variantId] += 1;
            }
            else {
                cartData[itemId][variantId] = 1;
            }
        }
        else {
            cartData[itemId] = {};
            cartData[itemId][variantId] = 1;
        }

        if (token) {
            try {
                const response = await axios.post(backendUrl + '/api/cart/add', {
                    productId: itemId,
                    variantId
                }, { headers: { token } })
                if (!response.data.success) {
                    throw new Error(response.data.message || 'Unable to add this option to your cart.')
                }
            } catch (error) {
                toast.error(error.response?.data?.message || error.message || 'Unable to add this option to your cart.')
                return false
            }
        }

        setCartItems(cartData);
        if (!token) guestCartRef.current = cartData;
        return true;
    }

    const getCartCount = () => {
        let totalCount = 0;
        for (const items in cartItems) {
            for (const item in cartItems[items]) {
                if (Number.isSafeInteger(cartItems[items][item]) && cartItems[items][item] > 0) {
                    totalCount += cartItems[items][item];
                }
            }
        }
        return totalCount;
    }

    const updateQuantity = async (itemId, variantId, quantity) => {

        const product = products.find(item => item._id === itemId);
        const variant = product?.variants?.find(item => item._id === variantId);
        if (!Number.isSafeInteger(quantity) || quantity < 0 ||
            (quantity > 0 && (!isVariantAvailable(variant) || quantity > availableQuantity(variant)))) {
            toast.error('The requested quantity is not available.');
            return false;
        }

        const cartData = structuredClone(cartItems);

        if (!cartData[itemId]) cartData[itemId] = {};
        if (quantity === 0) {
            delete cartData[itemId][variantId];
            if (Object.keys(cartData[itemId]).length === 0) delete cartData[itemId];
        } else {
            cartData[itemId][variantId] = quantity;
        }

        if (token) {
            try {
                const response = await axios.post(backendUrl + '/api/cart/update', {
                    productId: itemId,
                    variantId,
                    quantity
                }, { headers: { token } })
                if (!response.data.success) {
                    throw new Error(response.data.message || 'Unable to update your cart.')
                }
            } catch (error) {
                toast.error(error.response?.data?.message || error.message || 'Unable to update your cart.')
                return false
            }
        }

        setCartItems(cartData)
        if (!token) guestCartRef.current = cartData
        return true

    }

    const getCartAmountPaise = () => {
        let totalAmount = 0;
        for (const items in cartItems) {
            const product = products.find((item) => item._id === items);
            for (const variantId in cartItems[items]) {
                const variant = product?.variants?.find(item => item._id === variantId);
                if (variant && cartItems[items][variantId] > 0) {
                    const unitPricePaise = variant.priceOverridePaise ?? product.pricePaise;
                    if (Number.isSafeInteger(unitPricePaise)) {
                        totalAmount += unitPricePaise * cartItems[items][variantId];
                    }
                }
            }
        }
        return totalAmount;
    }

    const getCartAmount = () => getCartAmountPaise() / 100

    const getShippingAmount = subtotalPaise => {
        if (!Number.isSafeInteger(subtotalPaise) || subtotalPaise <= 0) return 0
        const threshold = siteSettings.shipping.freeShippingThresholdPaise
        if (Number.isSafeInteger(threshold) && threshold > 0 && subtotalPaise >= threshold) return 0
        const feePaise = siteSettings.shipping.feePaise
        return Number.isSafeInteger(feePaise) && feePaise >= 0 ? feePaise / 100 : 50
    }

    const getProductsData = useCallback(async () => {
        setProductsLoading(true);
        setProductsError('');
        try {

            const response = await axios.get(backendUrl + '/api/product/list', {
                params: { page: 1, limit: 60 }
            })
            if (response.data.success) {
                const pages = response.data.pagination?.pages || 1
                const remainingPages = await Promise.all(
                    Array.from({ length: Math.max(0, pages - 1) }, (_, index) =>
                        axios.get(backendUrl + '/api/product/list', {
                            params: { page: index + 2, limit: 60 }
                        })
                    )
                )
                const products = [
                    ...response.data.products,
                    ...remainingPages.flatMap(page => page.data.products || [])
                ]
                setProducts(products)
            } else {
                throw new Error(response.data.message || 'Unable to load the product catalogue.');
            }
        } catch (error) {
            const message = error.response?.data?.message || error.message || 'Unable to load the product catalogue.';
            setProductsError(message);
            toast.error(message);
        } finally {
            setProductsLoading(false);
        }
    }, [backendUrl])

    const getSiteSettings = useCallback(async () => {
        setSiteSettingsError('');
        try {
            const response = await axios.get(`${backendUrl}/api/storefront/public`);
            if (!response.data.success || !response.data.settings) {
                throw new Error(response.data.message || 'Unable to load storefront information.');
            }
            setSiteSettings({ ...defaultSiteSettings, ...response.data.settings });
            setSiteSettingsLoaded(true);
        } catch (error) {
            setSiteSettingsError(error.response?.data?.message || error.message ||
                'Unable to load storefront information.');
        }
    }, [backendUrl])

    const getProductById = useCallback(async productId => {
        const response = await axios.get(`${backendUrl}/api/product/${encodeURIComponent(productId)}`);
        if (!response.data.success || !response.data.product) {
            throw new Error(response.data.message || 'Product not found.');
        }
        const product = response.data.product;
        setProducts(current => current.some(item => item._id === product._id)
            ? current.map(item => item._id === product._id ? product : item)
            : [...current, product]);
        return product;
    }, [backendUrl]);

    const getUserCart = useCallback(async token => {
        // Take the guest cart up front so it can be merged exactly once, even if this runs again.
        const guestCart = guestCartRef.current
        guestCartRef.current = {}
        clearGuestCart()
        try {
            const response = await axios.post(`${backendUrl}/api/cart/get`, {}, { headers: { token } })
            if (!response.data.success) {
                throw new Error(response.data.message || 'Unable to load your cart.')
            }

            const limitFor = (productId, variantId) => {
                const variant = productsRef.current.find(item => item._id === productId)
                    ?.variants?.find(item => item._id === variantId)
                if (!variant) return null
                return isVariantAvailable(variant) ? availableQuantity(variant) : 0
            }
            const { merged, lines, dropped } = mergeCarts(response.data.cartData || {}, guestCart, limitFor)
            await Promise.all(lines.map(line =>
                axios.post(`${backendUrl}/api/cart/update`, {
                    productId: line.productId,
                    variantId: line.variantId,
                    quantity: line.quantity
                }, { headers: { token } }).then(updateResponse => {
                    if (!updateResponse.data.success) {
                        throw new Error(updateResponse.data.message || 'Unable to merge a cart item.')
                    }
                }).catch(error => {
                    // Show what the server actually holds so the cart never disagrees with it.
                    if (line.serverQuantity > 0) merged[line.productId][line.variantId] = line.serverQuantity
                    else {
                        delete merged[line.productId][line.variantId]
                        if (Object.keys(merged[line.productId]).length === 0) delete merged[line.productId]
                    }
                    dropped.push({ productId: line.productId, variantId: line.variantId })
                    toast.error(error.response?.data?.message || error.message || 'A cart item could not be synced. Review it before ordering.')
                })
            ))
            if (dropped.length > 0) {
                toast.info('Some items from your earlier bag could not be added because they are unavailable or at their stock limit.')
            }
            setCartItems(merged)
        } catch (error) {
            // Nothing was merged, so keep the guest cart for the next attempt.
            guestCartRef.current = guestCart
            saveGuestCart(guestCart)
            toast.error(error.response?.data?.message || error.message || 'Unable to load your cart.')
        }
    }, [backendUrl])

    useEffect(() => {
        getProductsData()
    }, [getProductsData])

    useEffect(() => {
        getSiteSettings()
    }, [getSiteSettings])

    useEffect(() => {
        productsRef.current = products
    }, [products])

    useEffect(() => {
        if (token) return
        guestCartRef.current = cartItems
        saveGuestCart(cartItems)
    }, [cartItems, token])

    useEffect(() => {
        if (token || productsLoading || productsError) return
        const { cart, removed } = reconcileGuestCart(cartItems, products)
        if (removed > 0) {
            setCartItems(cart)
            toast.info('Some items in your bag are no longer available and were removed.')
        }
    }, [token, productsLoading, productsError, products, cartItems])

    useEffect(() => {
        if (token) getUserCart(token)
    }, [getUserCart, token])

    const value = {
        products, productsLoading, productsError, getProductById, currency,
        refreshProducts: getProductsData,
        getCartAmountPaise, getShippingAmount,
        siteSettings, siteSettingsError, siteSettingsLoaded,
        search, setSearch, showSearch, setShowSearch,
        cartItems, addToCart,setCartItems, setProducts,
        getCartCount, updateQuantity,
        getCartAmount, navigate, backendUrl,
        setToken, token,
        refreshCart: () => (token ? getUserCart(token) : Promise.resolve())
    }

    return (
        <ShopContext.Provider value={value}>
            {props.children}
        </ShopContext.Provider>
    )

}

ShopContextProvider.propTypes = {
    children: PropTypes.node.isRequired
}

export default ShopContextProvider;