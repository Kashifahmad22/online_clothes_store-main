import { useContext, useEffect, useState } from 'react'
import { ShopContext } from '../context/ShopContext'
import { useNavigate, useSearchParams } from 'react-router-dom'

const SearchBar = () => {
    const { search, setSearch, showSearch, setShowSearch } = useContext(ShopContext)
    const navigate = useNavigate()
    const [searchParams] = useSearchParams()
    const [query, setQuery] = useState(searchParams.get('search') || search)

    useEffect(() => {
        if (showSearch) setQuery(searchParams.get('search') || search)
    }, [searchParams, search, showSearch])

    if (!showSearch) return null

    const submitSearch = event => {
        event.preventDefault()
        const cleanedQuery = query.trim()
        setSearch(cleanedQuery)
        setShowSearch(false)
        navigate(cleanedQuery ? `/collection?search=${encodeURIComponent(cleanedQuery)}` : '/collection')
    }

    return (
        <form className='search-panel' onSubmit={submitSearch} role='search'>
            <label className='sr-only' htmlFor='store-search'>Search products</label>
            <input id='store-search' autoFocus value={query}
                onChange={event => setQuery(event.target.value)} type='search'
                placeholder='Search products, fabric or colour' />
            <button type='submit' className='button button--wine'>Search</button>
            <button type='button' onClick={() => setShowSearch(false)}
                className='search-panel__close' aria-label='Close search'>×</button>
        </form>
    )
}

export default SearchBar
