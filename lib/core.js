const stringify = require('json-stringify-safe')
const toSource = require('tosource')
const debug = require('./debug')

const handle = (nugget, trace, modifier = e => e) => (error) => {
    error.nugget = nugget
    error.trace = trace

    throw (modifier(error) || error)
}

const shake = (id, nuggets, resolutions = {}) => {

    const { [id]: nugget } = nuggets

    if (!nugget) {
        throw new Error(`Cannot locate the nugget id: ${id}`)
    }

    resolutions[id] = nugget

    debug.connection.sendUTF(stringify({ source: toSource(nugget), id }))

    const { needs = [] } = nugget
    needs.forEach(need => shake(need, nuggets, resolutions))

    return resolutions
}

const resolve = async (ctx, nuggets, original, resolutions = {}) => {

    const { trace } = ctx
    const promises = nuggets.reduce((promises, nugget) => {

        const {
            config = () => {},
            needs = [],
            result,
            error,
            id
        } = nugget
        const { [id]: resolved } = resolutions

        debug.connection.sendUTF(stringify({ needs, id }))

        if (resolved) {
            return promises
        }

        const complete = needs.reduce((results, id) => {

            if (!results) {
                return false
            }

            const { [id]: resolved } = resolutions
            if (!resolved) {
                return false
            }

            const { result } = resolved
            return [ ...results, result ]

        }, [])

        if (!complete) {
            return promises
        }

        if (!result) {
            throw new Error(
                `The "${id}" nugget is missing a "result" function.`
            )
        }

        let configured = {}

        try {
            configured = config({ needs: complete, ctx })
            if (configured instanceof Promise) {
                throw new Error(
                    `The "${id}" nugget's "config" function must not be a promise.`
                )
            }

            debug.connection.sendUTF(stringify({ config: configured, id }))

            const helper = async (id) => await execute(id, original, ctx)

            const promise = result({
                config: configured,
                execute: helper,
                needs: complete,
                nuggets,
                ctx,
                id
            })

            if (!(promise instanceof Promise)) {
                throw new Error(
                    `The "${id}" nugget's "result" function must return a promise.`
                )
            }

            return [
                ...promises,
                (
                    promise
                        .then(result => ({ config: configured, result, id }))
                        .then(nugget => {
                            debug.connection.sendUTF(stringify(nugget))
                            return nugget
                        })
                        .catch(handle({ config: configured, id }, trace, error))
                )
            ]
        } catch (error) {
            handle({ config: configured, id }, trace)(error)
        }
    }, [])

    const results = await Promise.all(promises)

    results.forEach(nugget => {
        const { result, config, id } = nugget
        ctx.trace[id] = resolutions[id] = { result, config }
    })

    if (Object.keys(resolutions).length === nuggets.length) {
        return resolutions
    }

    return await resolve(ctx, nuggets, original, resolutions)
}

const keyBy = (arr, key) => (
    arr.reduce((collection, { [key]: id }, idx) => {
        collection[id] = arr[idx]
        return collection
    }, {})
)

const execute = async (id, nuggets, ctx = {}) => {
    try {

        debug.connection.sendUTF('CLEAR')

        if (!ctx.trace) {
            ctx.trace = {}
        }

        const shaken = shake(id, keyBy(nuggets, 'id'))
        const resolved = await resolve(ctx, Object.values(shaken), nuggets)
        const { [id]: target } = resolved
        const { result } = target

        return result
    } catch(err) {
        err.trace = ctx.trace
        throw err
    }
}

module.exports = execute
