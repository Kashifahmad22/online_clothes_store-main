import bcrypt from 'bcrypt'
import { createInterface } from 'node:readline'
import { Writable } from 'node:stream'
import { MAX_PASSWORD_BYTES, passwordExceedsBcryptLimit } from '../utils/adminCredentials.js'

// Prompts without echo and prints only the bcrypt hash. Nothing is written to disk.
const COST = 12
const MIN_LENGTH = 12

const muted = new Writable({ write(chunk, encoding, callback) { callback() } })

const ask = question => new Promise(resolve => {
    process.stdout.write(question)
    const rl = createInterface({ input: process.stdin, output: muted, terminal: true })
    rl.question('', answer => {
        rl.close()
        process.stdout.write('\n')
        resolve(answer)
    })
})

const password = await ask('New admin password: ')
const confirmation = await ask('Confirm password: ')

if (password !== confirmation) {
    console.error('Passwords do not match.')
    process.exit(1)
}
if (password.length < MIN_LENGTH) {
    console.error(`Use at least ${MIN_LENGTH} characters.`)
    process.exit(1)
}
if (passwordExceedsBcryptLimit(password)) {
    console.error(`Passwords longer than ${MAX_PASSWORD_BYTES} bytes are not supported.`)
    process.exit(1)
}

console.log('\nSet this as ADMIN_PASSWORD_HASH (wrap in single quotes in a local .env file):\n')
console.log(await bcrypt.hash(password, COST))
