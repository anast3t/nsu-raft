function getPrefix(prefix: string) {
    return `[${prefix} - ${new Date().getSeconds()}.${new Date().getMilliseconds()}]`
}

export function customLog(prefix: string, ...args: any[]) {
    // if([
    //     "ELECTION",
    //     "CONNECTION"
    // ].map(el => {
    //     if(!prefix.includes(el))
    //         return el
    // }).length > 0) {
    //     return
    // }
    console.log(getPrefix(prefix), ...args)
}

export function getMilliseconds() {
    return Date.now()
}

export function getSeconds() {
    return Math.round(Date.now() / 1000.0)
}
