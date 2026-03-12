require("dotenv").config()

process.on("uncaughtException", console.error)
process.on("unhandledRejection", console.error)

const {
default: makeWASocket,
useMultiFileAuthState,
fetchLatestBaileysVersion,
DisconnectReason
} = require("@whiskeysockets/baileys")

const pino = require("pino")
const Groq = require("groq-sdk")

/* ================= CONFIG ================= */

const PHONE_NUMBER = process.env.PHONE_NUMBER

if(!PHONE_NUMBER){
console.log("❌ PHONE_NUMBER belum di set di ENV")
process.exit()
}

const groq = new Groq({
apiKey: process.env.GROQ_API_KEY
})

/* ================= DATABASE ================= */

const memory = {}
const spam = {}
const aiMode = {}

let pairingCodeRequested = false

/* ================= BOT ================= */

async function startBot(){

const { state, saveCreds } = await useMultiFileAuthState("./auth")

const { version } = await fetchLatestBaileysVersion()

const sock = makeWASocket({
version,
logger: pino({ level:"silent" }),
auth: state,
printQRInTerminal:false,
browser:["Ubuntu","Chrome","20.0.04"]
})

sock.ev.on("creds.update", saveCreds)

/* ================= CONNECTION ================= */

sock.ev.on("connection.update", async(update)=>{

const { connection, lastDisconnect } = update

if(connection === "connecting"){
console.log("🔄 Menghubungkan ke WhatsApp...")
}

/* ================= PAIRING ================= */

if(!sock.authState.creds.registered && !pairingCodeRequested){

pairingCodeRequested = true

setTimeout(async()=>{

try{

const code = await sock.requestPairingCode(PHONE_NUMBER)

console.log("\n==============================")
console.log("PAIRING CODE ANDA:")
console.log(code)
console.log("==============================\n")

console.log("Masukkan di WhatsApp:")
console.log("Linked Devices → Link with phone number\n")

}catch(err){

console.log("❌ PAIRING ERROR:", err)

pairingCodeRequested = false

}

},2000)

}

/* ================= CONNECTED ================= */

if(connection === "open"){
console.log("✅ BOT ONLINE")
}

/* ================= RECONNECT ================= */

if(connection === "close"){

const reason = lastDisconnect?.error?.output?.statusCode

console.log("❌ Connection closed:", reason)

if(reason !== DisconnectReason.loggedOut){

console.log("♻️ Reconnecting bot...")
pairingCodeRequested = false
startBot()

}else{

console.log("⚠️ Device logged out, hapus folder auth lalu deploy ulang.")

}

}

})

/* ================= MESSAGE ================= */

sock.ev.on("messages.upsert", async({ messages })=>{

const msg = messages[0]
if(!msg.message) return

const from = msg.key.remoteJid
const sender = msg.key.participant || from

const text =
msg.message.conversation ||
msg.message.extendedTextMessage?.text ||
""

if(!text) return

/* ================= ANTI SPAM ================= */

if(!spam[sender]) spam[sender] = 0

spam[sender]++

setTimeout(()=>{
spam[sender] = 0
},4000)

if(spam[sender] > 6){

return sock.sendMessage(from,{
text:"⚠️ Jangan spam bot"
})

}

/* ================= MEMORY ================= */

if(!memory[sender]){
memory[sender] = []
}

/* ================= MENU ================= */

if(text === ".menu"){

return sock.sendMessage(from,{
text:`
🤖 AI WHATSAPP BOT

1. .chat ai
2. .akhiri chat

Gunakan *.chat ai* untuk mulai AI chat.
`
})

}

/* ================= START AI ================= */

if(text === ".chat ai"){

aiMode[sender] = true

return sock.sendMessage(from,{
text:"🤖 Mode AI aktif.\n\nKirim pesan apa saja.\n\nKetik *.akhiri chat* untuk berhenti."
})

}

/* ================= STOP AI ================= */

if(text === ".akhiri chat"){

aiMode[sender] = false
memory[sender] = []

return sock.sendMessage(from,{
text:"✅ Chat AI dihentikan."
})

}

/* ================= AI CHAT ================= */

if(aiMode[sender]){

memory[sender].push({
role:"user",
content:text
})

if(memory[sender].length > 20){
memory[sender].shift()
}

try{

const chat = await groq.chat.completions.create({
model:"llama-3.1-8b-instant",
messages: memory[sender]
})

const reply =
chat?.choices?.[0]?.message?.content ||
"AI tidak memberi jawaban."

memory[sender].push({
role:"assistant",
content:reply
})

await sock.sendMessage(from,{
text: reply
})

}catch(err){

console.log("AI ERROR:", err)

await sock.sendMessage(from,{
text:"⚠️ AI sedang error, coba lagi."
})

}

}

})

}

startBot()
