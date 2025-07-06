const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
require('dotenv').config();

const OpenAI = require("openai");

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

const http = require('http'); // Dodano za web server

const client = new Client({
  authStrategy: new LocalAuth()
});

// Jednostavan HTTP server za Render i Uptimerobot
const port = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/plain'});
  res.end('Bot je aktivan\n');
});
server.listen(port, () => {
  console.log(`Server sluša na portu ${port}`);
});

// Učitaj podatke ili kreiraj prazne ako nema fajlova
let paketi = [];
try {
    paketi = JSON.parse(fs.readFileSync('./paketi.json'));
} catch { paketi = []; }

let admini = [];
try {
    admini = JSON.parse(fs.readFileSync('./admini.json'));
} catch { admini = []; }

let prijavljeniAdmini = [];
let sesije = {};

// Samo ovi brojevi imaju pravo izmjena
const dozvoljeniAdmini = [
    '38765061038@c.us'
];

// Set za praćenje ko je već dobio AI pozdrav
let aiPozdravljeni = new Set();

client.on('qr', qr => {
    const qrLink = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(qr)}&size=250x250`;
    console.log("📱 Otvori ovaj link da vidiš QR kod:");
    console.log(qrLink);
});

client.on('ready', () => {
    console.log('✅ Bot je spreman!');
});

function sacuvajPakete() {
    fs.writeFileSync('./paketi.json', JSON.stringify(paketi, null, 2));
}
function sacuvajAdmin() {
    fs.writeFileSync('./admini.json', JSON.stringify(admini, null, 2));
}

client.on('message', async msg => {
    const broj = msg.from;
    const tekst = msg.body.trim();
    const tekstLower = tekst.toLowerCase();

    // LOGIN bez da se prikazuje lozinka
    if (!admini.includes(broj) && tekst === 'tajna123') {
        admini.push(broj);
        prijavljeniAdmini.push(broj);
        sacuvajAdmin();
        return msg.reply('🔐 Uspješno si se prijavio kao admin.');
    }

    // AI MODE kontrola
    if (!sesije[broj]) sesije[broj] = { modAI: false, korak: null, podaci: {} };
    const s = sesije[broj];

    if (tekstLower === 'ai') {
        s.modAI = true;
        return msg.reply('🤖 AI mod je aktiviran. Piši šta želiš, a da izađeš, pošalji `left`.');
    }
    if (tekstLower === 'left') {
        s.modAI = false;
        s.korak = null;
        s.podaci = {};
        return msg.reply('⬅️ Vratio si se na standardni režim.');
    }

    if (s.modAI) {
        // AI odgovor
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
        return msg.reply(`📚 Komande:

➡️ status - prikaz paketa
➡️ help - prikaz komandi
➡️ ai - uključi AI mod (sve što pišeš u njemu bot odgovara)
➡️ left - isključi AI mod, vraća te na pakete

🔐 (Admini)
🆕 novi - dodaj paket
✏️ izmijeni - izmijeni postojeći paket`);
    }

    // STATUS ZA SVE
    if (tekstLower === 'status') {
        if (paketi.length === 0) return msg.reply('📦 Trenutno nema dostupnih paketa.');
        let txt = '📦 Lista paketa:\n';
        paketi.forEach((p, i) => {
            txt += `${i + 1}. ${p.naziv}\n`;
        });
        return msg.reply(txt + '\n\nPošalji broj paketa za više informacija.');
    }

    // Prikaz informacija o paketu po broju
    const brojPaketa = parseInt(tekst);
    if (!isNaN(brojPaketa) && brojPaketa >= 1 && brojPaketa <= paketi.length) {
        const p = paketi[brojPaketa - 1];
        return msg.reply(`📦 Info:

🆔 ID: ${p.id}
📛 Naziv: ${p.naziv}
📅 Vrijeme: ${p.vrijeme}
📍 Status: ${p.status}`);
    }

    // Ako nije admin → prekini
    if (!admini.includes(broj)) return;

    // Prijavi sesiju ako nije već
    if (!prijavljeniAdmini.includes(broj)) prijavljeniAdmini.push(broj);

    // NOVI paket
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
        s.podaci.status = tekst; // case-sensitive
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

    // IZMJENA paketa - sad ide lista paketa za izbor
    if (tekstLower === 'izmijeni') {
        if (!dozvoljeniAdmini.includes(broj)) return msg.reply('🚫 Nemaš dozvolu za izmjene.');
        if (paketi.length === 0) return msg.reply('📦 Nema paketa za izmjenu.');
        s.korak = 'izm_listaj';
        // Napravi listu paketa s brojevima i nazivima
        let listaPaketa = '📦 Izaberi paket za izmjenu:\n';
        paketi.forEach((p, i) => {
            listaPaketa += `${i + 1}. ${p.naziv} (ID: ${p.id})\n`;
        });
        return msg.reply(listaPaketa);
    }

    if (s.korak === 'izm_listaj') {
        const brojIzmjene = parseInt(tekst);
        if (isNaN(brojIzmjene) || brojIzmjene < 1 || brojIzmjene > paketi.length) {
            return msg.reply('❌ Netačan izbor. Molim pošalji redni broj paketa sa liste.');
        }
        const p = paketi[brojIzmjene - 1];
        s.podaci = { original: p };
        s.korak = 'izm_naziv';
        return msg.reply(`📛 Novi naziv? (pošalji . za isti: ${p.naziv})`);
    }

    if (s.korak === 'izm_naziv') {
        if (tekst !== '.') s.podaci.original.naziv = tekst;
        s.korak = 'izm_status';
        return msg.reply(`📍 Novi status? (pošalji . za isti: ${s.podaci.original.status})`);
    }

    if (s.korak === 'izm_status') {
        if (tekst !== '.') s.podaci.original.status = tekst; // case-sensitive
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

    // Nepoznata komanda ako nije u sesiji unosa
    if (!s.korak) {
        return msg.reply('❌ Nepoznata komanda. Pošalji `help` za listu komandi.');
    }
});

client.initialize();
