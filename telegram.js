const { default: axios } = require("axios")

const sendTelegram = async (message) => {
    try {
        axios.get(`https://mowj-notifs.dangi.workers.dev/send?${message}`)
    }
    catch (e) { console.log('----ERR TELEGRAM') }
}

module.exports = { sendTelegram };
