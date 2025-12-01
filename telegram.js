const { default: axios } = require("axios")

const sendTelegram = async (message) => {
    axios.get(`https://mowj-notifs.dangi.workers.dev/send?${message}`)
}

module.exports = { sendTelegram };
