const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
require('dotenv').config();
const http = require('http');
const OpenAI = require("openai");

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const client = new Client({ authStrategy: new LocalAuth() });

const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Bot je aktivan\n');
});
server.listen(port, () => console.log(`Server sluša na portu ${port}`));

// -------------------- Učitavanje podataka ---------------------
let paketi = [], admini = [], prijavljeniAdmini = [], chatovi = [];
let sesije = {};
const aiPozdravljeni = new Set();
const dozvoljeniAdmini = ['38765061038@c.us'];

try { paketi = JSON.parse(fs.readFileSync('./paketi.json')); } catch {}
try { admini = JSON.parse(fs.readFileSync('./admini.json')); } catch {}
try { chatovi = JSON.parse(fs.readFileSync('./chatovi.json')); } catch {}

function sacuvajPakete() { fs.writeFileSync('./paketi.json', JSON.stringify(paketi, null, 2)); }
function sacuvajAdmin() { fs.writeFileSync('./admini.json', JSON.stringify(admini, null, 2)); }
function sacuvajChatove() { fs.writeFileSync('./chatovi.json', JSON.stringify(chatovi, null, 2)); }

client.on('qr', qr => {
  const qrLink = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=250x250`;
  console.log("📱 Otvori ovaj link da vidiš QR kod:");
  console.log(qrLink);
});

client.on('ready', () => console.log('✅ Bot je spreman!'));

client.on('message', async msg => {
  const broj = msg.from;
  const tekst = msg.body.trim();
  const tekstLower = tekst.toLowerCase();

  // Zabilježi chat
  if (!chatovi.includes(broj)) {
    chatovi.push(broj);
    sacuvajChatove();
  }

  if (!admini.includes(broj) && tekst === 'tajna123') {
    admini.push(broj);
    prijavljeniAdmini.push(broj);
    sacuvajAdmin();
    return msg.reply('🔐 Uspješno si se prijavio kao admin.');
  }

  if (!sesije[broj]) sesije[broj] = { modAI: false, korak: null, podaci: {} };
  const s = sesije[broj];

  // AI MOD
  if (tekstLower === 'ai') {
    s.modAI = true;
    return msg.reply('🤖 AI mod je aktiviran. Piši šta želiš, a da izađeš, pošalji left.');
  }
  if (tekstLower === 'left') {
    s.modAI = false;
    s.korak = null;
    s.podaci = {};
    return msg.reply('⬅️ Vratio si se na standardni režim.');
  }

  if (s.modAI) {
    try {
      if (!aiPozdravljeni.has(broj)) {
        await msg.reply('👋 Cao! Ja sam vještačka inteligencija kreirana od strane Luke Adžića. Pitaj me šta želiš!');
        aiPozdravljeni.add(broj);
      }

      const response = await openai.chat.completions.create({
        model: "gpt-4.1-nano",
        messages: [
          { role: "system", content: "Odgovaraj kratko i jasno." },
          { role: "user", content: tekst }
        ],
        max_tokens: 100,
        temperature: 0.5,
      });

      const odgovor = response.choices[0].message.content.trim();
      return msg.reply(`🤖 AI odgovor:\n${odgovor}`);
    } catch (error) {
      console.error("OpenAI greška:", error.response?.data || error.message);
      return msg.reply('❌ Došlo je do greške prilikom komunikacije sa AI.');
    }
  }

  // HELP
  if (tekstLower === 'help') {
    return msg.reply(admini.includes(broj) ? `📚 ADMIN KOMANDE:

➡️ status - prikaz paketa
➡️ help - prikaz komandi
➡️ ai - uključi AI mod
➡️ left - isključi AI mod

🔧 ADMIN:
🆕 novi - dodaj paket
✏️ izmijeni - izmijeni postojeći paket
🛠️ maintenance - obavijesti sve korisnike o održavanju
` : `📚 Komande:

➡️ status - prikaz paketa
➡️ help - prikaz komandi
➡️ ai - uključi AI mod
➡️ left - isključi AI mod`);
  }

  // STATUS
  if (tekstLower === 'status') {
    if (paketi.length === 0) return msg.reply('📦 Trenutno nema dostupnih paketa.');
    let txt = '📦 Lista paketa:\n';
    paketi.forEach((p, i) => txt += `${i + 1}. ${p.naziv}\n`);
    return msg.reply(txt + '\n\nPošalji broj paketa za više informacija.');
  }

  // Detalji o paketu
  const brojPaketa = parseInt(tekst);
  if (!isNaN(brojPaketa) && brojPaketa >= 1 && brojPaketa <= paketi.length) {
    const p = paketi[brojPaketa - 1];
    if (s.korak === 'izm_odabir') {
      s.podaci.original = p;
      s.korak = 'izm_naziv';
      return msg.reply(`📛 Novi naziv? (pošalji . za isti: ${p.naziv})`);
    }
    return msg.reply(`📦 Info:

🆔 ID: ${p.id}
📛 Naziv: ${p.naziv}
📅 Vrijeme: ${p.vrijeme}
📍 Status: ${p.status}`);
  }

  // ADMIN
  if (!admini.includes(broj)) return;
  if (!prijavljeniAdmini.includes(broj)) prijavljeniAdmini.push(broj);

  if (tekstLower === 'novi') {
    s.korak = 'novi_id';
    s.podaci = {};
    return msg.reply('🆕 Unesi ID paketa:');
  }

  if (s.korak === 'novi_id') {
    s.podaci.id = tekst;
    s.korak = 'novi_naziv';
    return msg.reply('📛 Unesi naziv paketa:');
  }
  if (s.korak === 'novi_naziv') {
    s.podaci.naziv = tekst;
    s.korak = 'novi_status';
    return msg.reply('📍 Unesi status paketa:');
  }
  if (s.korak === 'novi_status') {
    s.podaci.status = tekst;
    s.korak = 'novi_vrijeme';
    return msg.reply('📅 Unesi vrijeme (ili . za sadašnje):');
  }
  if (s.korak === 'novi_vrijeme') {
    s.podaci.vrijeme = tekst === '.' ? new Date().toLocaleString() : tekst;
    paketi.push(s.podaci);
    sacuvajPakete();
    s.korak = null;
    s.podaci = {};
    return msg.reply('✅ Paket dodat!');
  }

  // IZMJENA
  if (tekstLower === 'izmijeni') {
    if (!dozvoljeniAdmini.includes(broj)) return msg.reply('🚫 Nemaš dozvolu za izmjene.');
    if (paketi.length === 0) return msg.reply('📦 Nema paketa za izmjenu.');

    let txt = '📦 Izaberi paket za izmjenu:\n';
    paketi.forEach((p, i) => txt += `${i + 1}. ${p.naziv}\n`);
    s.korak = 'izm_odabir';
    return msg.reply(txt + '\n\nPošalji broj paketa koji želiš izmijeniti:');
  }

  if (s.korak === 'izm_naziv') {
    if (tekst !== '.') s.podaci.original.naziv = tekst;
    s.korak = 'izm_status';
    return msg.reply(`📍 Novi status? (pošalji . za isti: ${s.podaci.original.status})`);
  }

  if (s.korak === 'izm_status') {
    if (tekst !== '.') s.podaci.original.status = tekst;
    s.korak = 'izm_vrijeme';
    return msg.reply(`📅 Novo vrijeme? (pošalji . za isti: ${s.podaci.original.vrijeme})`);
  }

  if (s.korak === 'izm_vrijeme') {
    if (tekst !== '.') s.podaci.original.vrijeme = tekst;
    sacuvajPakete();
    s.korak = null;
    s.podaci = {};
    return msg.reply('✅ Paket izmijenjen!');
  }

  // MAINTENANCE
  if (tekstLower === 'maintenance') {
    for (const chatId of chatovi) {
      try {
        await client.sendMessage(chatId, '🛠️ Bot je trenutno u režimu održavanja. Biće dostupan uskoro.');
      } catch (e) {
        console.error(`Greška pri slanju korisniku ${chatId}:`, e.message);
      }
    }
    return msg.reply('✅ Maintenance obavijest poslana svim kontaktima.');
  }

  if (!s.korak) return msg.reply('❌ Nepoznata komanda. Pošalji `help` za listu komandi.');
});

client.initialize();
