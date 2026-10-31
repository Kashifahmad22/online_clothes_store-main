import { Link } from 'react-router-dom'

const Verify = () => (
    <main className='border-t py-16 text-center'>
        <h1 className='text-2xl font-medium'>Online payment is not available</h1>
        <p className='mt-4 text-gray-600'>
            No payment has been confirmed on this page. Please return to your cart and choose cash on delivery.
        </p>
        <Link to='/cart' className='inline-block mt-8 bg-black px-8 py-3 text-white'>
            Return to cart
        </Link>
    </main>
)

export default Verify
