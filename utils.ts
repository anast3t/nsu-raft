function getPrefix(prefix: string) {
    return `[${prefix} - ${new Date().getSeconds()}.${new Date().getMilliseconds()}]`
}

export function customLog(prefix: string, ...args: any[]) {
    console.log(getPrefix(prefix), ...args)
}
