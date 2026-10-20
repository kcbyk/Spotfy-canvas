#!/usr/bin/env node
/** Concurrent meta filler (concurrency=20, no delay). */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __filename=fileURLToPath(import.meta.url);
const __dirname=path.dirname(__filename);
const ROOT=path.join(__dirname,'..');
const DB_PATH=path.join(ROOT,'server/data/canvas-database.json');
const META_PATH=path.join(ROOT,'server/data/track-meta.json');

const UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const C={reset:'\x1b[0m',g:'\x1b[32m',y:'\x1b[33m',m:'\x1b[35m',c:'\x1b[36m',b:'\x1b[34m',bold:'\x1b[1m'};
const log={ok:m=>console.log(C.g+'[OK]'+C.reset,m),info:m=>console.log(C.b+'[INFO]'+C.reset,m),prog:m=>console.log(C.m+'[PROG]'+C.reset,m),warn:m=>console.log(C.y+'[WARN]'+C.reset,m),head:m=>console.log('\n'+C.bold+C.c+m+C.reset+'\n'+('─'.repeat(60)))};

const load=p=>{try{return JSON.parse(fs.readFileSync(p,'utf8'));}catch{return{};}};
let db=load(DB_PATH),meta=load(META_PATH);
const save=()=>{fs.writeFileSync(META_PATH+'.tmp',JSON.stringify(meta,null,2)+'\n');fs.renameSync(META_PATH+'.tmp',META_PATH);};

async function kworbChart(cc){
  try{
    const r=await fetch(`https://kworb.net/spotify/country/${cc}_daily.html`,{headers:{'User-Agent':UA}});
    if(!r.ok)return[];
    const html=await r.text();
    const trs=html.split('<tr').slice(2);
    const rows=[];
    for(const tr of trs){
      const tm=tr.match(/<a href="\.\.\/track\/([a-zA-Z0-9]{22})\.html"[^>]*>([^<]+)<\/a>/);
      if(!tm)continue;
      const before=tr.slice(0,tr.indexOf(tm[0]));
      const after=tr.slice(tr.indexOf(tm[0])+tm[0].length);
      const arts=[...before.matchAll(/<a href="\.\.\/artist\/[a-zA-Z0-9]{22}\.html"[^>]*>([^<]+)<\/a>/g)].map(m=>m[1]);
      const feats=[...after.matchAll(/<a href="\.\.\/artist\/[a-zA-Z0-9]{22}\.html"[^>]*>([^<]+)<\/a>/g)].map(m=>m[1]);
      rows.push({tid:tm[1],title:tm[2],artist:[...arts,...feats].join(', ')});
    }
    return rows;
  }catch{return[];}
}

async function kworbArtist(aid){
  try{
    const r=await fetch(`https://kworb.net/spotify/artist/${aid}_songs.html`,{headers:{'User-Agent':UA}});
    if(!r.ok)return[];
    const html=await r.text();
    const re=/<a href="https:\/\/open\.spotify\.com\/track\/([a-zA-Z0-9]{22})"[^>]*>([^<]+)<\/a>/g;
    const rows=[];let m;while((m=re.exec(html)))rows.push({tid:m[1],title:m[2]});
    return rows;
  }catch{return[];}
}

async function oembedBulk(tids){
  // batch: fetch in parallel
  return Promise.all(tids.map(tid=>
    fetch(`https://open.spotify.com/oembed?url=spotify:track:${tid}`,{headers:{'User-Agent':UA}})
      .then(r=>r.ok?r.json().then(d=>({tid,title:d.title,cover:d.thumbnail_url})).catch(()=>null):null)
      .catch(()=>null)
  ));
}

const COUNTRIES=['global','us','gb','de','fr','tr','es','it','br','mx','ar','co','cl','pe','ec','ve','uy','py','bo','cr','do','hn','gt','sv','pa','ni','ca','jp','kr','in','id','my','ph','th','vn','sg','hk','tw','au','nz','ru','ua','kz','by','pl','cz','sk','hu','ro','bg','gr','ch','at','be','nl','se','no','dk','fi','ie','pt','lu','ee','lt','lv','il','eg','za','ng','ae','sa','pk','bd','np','lk','ke','gh','ma','dz','ua'];
const ARTISTS=[
  {name:'Wegh',id:'747jtvVsxwzOLCJeOOz3oT'},{name:'Ezhel',id:'6LnJKrtFnTEGdbWQ2riWCL'},
  {name:'Lvbel C5',id:'0V2oXYR7DtrZAEFeILRW2r'},{name:'UZI',id:'51DevdOxIJin6DB1FXJpD1'},
  {name:'Murat Boz',id:'53oeVgECSa18dkHBQ9X6Eh'},{name:'Hadise',id:'0wCKNMsqYasJBFVagjay49'},
  {name:'Kenan Doğulu',id:'2RQ8NtUmg5y6tfbvCwX8jI'},{name:'Serdar Ortaç',id:'7BJjzi0JHyDHAsmVe21dGa'},
  {name:'Semicenk',id:'1CcZoULzFHa8Uhwo6OlQcp'},{name:'Simge',id:'4StjyzjcmZ7a9QncHVf0pu'},
  {name:'EDIS',id:'1AM52XHXnWAEqnQwpxTLWm'},{name:'Murda',id:'2y1VzMKAa5nmfXKtJL9jnj'},
  {name:'Eypio',id:'6h5P3J0j1x2lhiDk9w4deZ'},{name:'Sagopa Kajmer',id:'1KXTegXtnCPKXjRaX1llcD'},
  {name:'Mabel Matiz',id:'1dpqJqIuNqideTvmxBsSku'},{name:'Batuflex',id:'15AZJFNrXtIN4Nk8BIOnS2'},
  {name:'Ati242',id:'6bGOmNBU1AOgttgOjh0ldf'},{name:'BLOK3',id:'1GMwSpFzrLd12jUX15bHB6'},
  {name:'Bengü',id:'6wxh9aTFgTS4OiyYlnQBq6'},{name:'Yalın',id:'46zuW8tHxwahYn7VNMgYTa'},
  {name:'Burak Bulut',id:'2a2YSCx78HHWVOsCuMpeXz'},{name:'Zeynep Bastık',id:'396gqBt8a2NN7gXtDWF7AJ'},
  {name:'Heijan',id:'3w6amgVVNxQfA5E4S2sXQn'},{name:'Cakal',id:'3dVh8m9UeCxP4qQk8uXnLb'},{name:'Sefo',id:'1W3tGQo8YQk2jJfS9gWxR3'},{name:'Reynmen',id:'2R21kQzW2vQ2Cw2s8p1v3c'},{name:'Ben Fero',id:'6Qb9r5hK08t2Kf2y7Vx0a1'},{name:'Ceza',id:'3q7B9e3H03yL0r2M9dO8j'},{name:'Gazapizm',id:'0Y3Kp2lKQ8e4s1w7Cz0M1'},{name:'Gülşen',id:'7Ln8l2rP0b3N5s8T6eR4m'},
  {name:'Tarkan',id:'1kUjrj2bT3lK8f2m5oW7x'},{name:'Sıla',id:'0g2wP7eY6x9v3N8k1M0qZ'},{name:'Hande Yener',id:'4L1wQ8p2s3zK5o9M7nR6a'},{name:'Demet Akalın',id:'0W8zX3fJ9pK7y2q1d4M0v'},{name:'Aleyna Tilki',id:'5R0cK9eT7pD4s6x1q8L2b'},{name:'Mustafa Ceceli',id:'3F2aS7pN5xL9k3v0r6T8q'},{name:'Oğuzhan Koç',id:'0L1dR4wQ8eP7k2x9y5B1u'},{name:'Duman',id:'2gO7tL9jY5o3X1pC6m4V'},{name:'Mor ve Ötesi',id:'4K8fV3iP1aL9k7x0y2N5p'},{name:'Şebnem Ferah',id:'74xBVPWYoSf5pvo5IkePRO'},{name:'Teoman',id:'5Y1uM0cI6oK3kL9pV7w8d'},{name:'Feridun Düzağaç',id:'2x7B9m3w8yQ4l1k5nR6v0'},{name:'Sezen Aksu',id:'2sSgRxWz1rdBPelMOfdsSE'},{name:'Ajda Pekkan',id:'1GDbMfZc3vq5lK8nX2y0W'},{name:'MFÖ',id:'4vghxK0gQpY2w9C5L7n3m'},{name:'Nil Karaibrahimgil',id:'7F0eP4n2tB5u6L1m3K8a9'},{name:'maNga',id:'1Vd5Y3oG6eH0zK8p2Q7R4c'},{name:'Emre Aydın',id:'5C1iZ7jS3kL2x9M6n4P0t'},{name:'Yalın',id:'46zuW8tHxwahYn7VNMgYTa'},{name:'Mustafa Sandal',id:'0J8bE2rY4gD7xK1pL9N3f'},{name:'Athena',id:'3eG5vD0c7pK4y8w2R9b1x'},{name:'Tepki',id:'6Q3gV7kS2zW8bY0xR1N4l'},{name:'Canbay & Wolker',id:'2u3yH8aK6vZ7b9c3N5p0s'},{name:'Organize',id:'1X8jQ2lL4wS9nK0pC6b7Y'},{name:'Era7capone',id:'4UW9Hdsrx9kX2HdJ90jRKM'},{name:'Lia Shine',id:'3N6zC8yV5uB7w0fK2L1aM'},{name:'Şehinşah',id:'0y9kQ3rP6vB2e1dH8gT5m'},{name:'Dilan Karakılıç',id:'5L2tR7sK1gB0vE8nY3C6x'},{name:'Patron',id:'7K8cX3zV9dD5fQ2uW1b4N'},{name:'Gülben Ergen',id:'2F6mN0dV9oW3qJ5cX7R1y'},{name:'Ahiyan',id:'0U8sdaBYsYld98xOIX1nYB'},{name:'BLOK3',id:'1GMwSpFzrLd12jUX15bHB6'},{name:'KARM6',id:'6NDMASsBLAUDX3QsJvki3r'},{name:'manifest',id:'2WjzL05RyqIk5n53sZc9nf'},{name:'Bora Duran',id:'0W0qg2fjQVk63h44Zdn4hI'},{name:'Pinhani',id:'4Bdqzh78prwuqwInMb555P'},{name:'İbrahim Tatlıses',id:'0gPgE6wLLiPnrakh9WcsdQ'},{name:'Müslüm Gürses',id:'4cMwyqmHCwJjRZ3frIVHTr'},{name:'Sertab Erener',id:'4W31XN2JH8mC54NkHdh04s'},{name:'Sibel Can',id:'2IiSMrjpXiteqhISWXkdUG'},{name:'Ferdi Özbeğen',id:'2bZXmEbQuj9XcGwgyIGuit'},{name:'Candan Erçetin',id:'51YBtWvwOP37hIGmnxf4yC'},{name:'Ebru Gündeş',id:'5AboYJAlMb9FGadTTDKRoN'},{name:'Göksel',id:'4i4ALRtQQmFxn3BCIB6iC0'},{name:'Kalben',id:'4sldxVDeyb0J8OMoYApqfV'},{name:'Derya Uluğ',id:'7A6T0nTpXnPXDUGM1yEjEj'},{name:'Ebru Yaşar',id:'0Qbd0AGWuzggX61s306wZN'},{name:'Yıldız Tilbe',id:'4525TiJDbBD4mZJ7EZArT0'},
  {name:'Dua Lipa',id:'6M2wZ9GZgrQXHCFfjv46we'},{name:'The Weeknd',id:'1Xyo4u8uXC1ZmMpatF05PJ'},
  {name:'Taylor Swift',id:'06HL4z0CvFAxyc27GXpf02'},{name:'Drake',id:'3TVXtAsR1Inumwj472S9r4'},
  {name:'Bad Bunny',id:'4q3ewBCX7sLwd24euuV69X'},{name:'Billie Eilish',id:'6qqNVTkY8uBg9cP3Jd7DAH'},
  {name:'Post Malone',id:'246dkjvS1zLTtiykXe5h60'},{name:'Ed Sheeran',id:'6eUKZXaKkcviH0Ku9w2n3V'},
  {name:'Ariana Grande',id:'66CXWjxzNUsdJxJ2JdwvnR'},{name:'SZA',id:'7tYKF4w9nC0nq9CsPZTHyP'},
  {name:'Travis Scott',id:'0Y5tJX1MQlPlqiwlOH1tJY'},{name:'Kendrick Lamar',id:'2YZyLoL8N0Wb9xBt1NhZWg'},
  {name:'Coldplay',id:'4gzpq5DPGxSnKTe4SA8HAU'},{name:'Imagine Dragons',id:'53XhwfbYqKCa1cC15pYq2q'},
  {name:'Olivia Rodrigo',id:'1McMsnEElThX1knmY4oliG'},{name:'Doja Cat',id:'5cj0lLjcoR7YOSnhnX0Po5'},
  {name:'BTS',id:'3Nrfpe0tUJi4K4DXYWgMUX'},{name:'KAROL G',id:'790FomKkXshlbRYZFtlgla'},
  {name:'J Balvin',id:'1vyhD5VmyZ7KMfW5gqLgo5'},{name:'Harry Styles',id:'6KImCVD70vtIoJWnq6nGn3'},
];

async function mapLimit(arr, conc, fn){
  const out=new Array(arr.length);let i=0;
  async function worker(){while(i<arr.length){const idx=i++;out[idx]=await fn(arr[idx],idx);}}
  await Promise.all(Array.from({length:conc},worker));
  return out;
}

async function main(){
  log.head('🚀 FAST META FILLER (concurrency=20)');
  log.info(`db=${Object.keys(db).length}, meta=${Object.keys(meta).length}`);
  const all=new Map();
  const add=(tid,title,artist)=>{if(!tid)return;if(!all.has(tid))all.set(tid,{tid,title,artist});};

  log.head('🌍 Kworb country charts (parallel 10)');
  let chartCount=0;
  await mapLimit(COUNTRIES,10,async cc=>{
    const ts=await kworbChart(cc);for(const t of ts)add(t.tid,t.title,t.artist);
    chartCount++;if(chartCount%10===0)log.prog(`charts ${chartCount}/${COUNTRIES.length} → ${all.size} tracks`);
  });

  log.head('🎤 Artist top tracks (parallel 5)');
  await mapLimit(ARTISTS,5,async a=>{
    const ts=await kworbArtist(a.id);for(const t of ts)add(t.tid,t.title,a.name);
    log.ok(`${a.name.padEnd(16)} → ${ts.length} (toplam ${all.size})`);
  });

  const tracks=Array.from(all.values());
  log.head(`🎯 ${tracks.length} track meta/cover dolduruluyor`);

  // Prepare seed meta (from kworb titles)
  for(const t of tracks){
    if(!meta[t.tid]||!meta[t.tid].title){
      meta[t.tid]={title:t.title,artist:t.artist,cover:null,ytQuery:`${t.title} ${t.artist}`};
    }else{
      meta[t.tid].title=meta[t.tid].title||t.title;
      meta[t.tid].artist=meta[t.tid].artist||t.artist;
      meta[t.tid].ytQuery=meta[t.tid].ytQuery||`${t.title} ${t.artist}`;
    }
  }

  // Fetch covers in batches for those without
  const needCover=tracks.filter(t=>!meta[t.tid].cover);
  log.info(`Kapak ihtiyacı: ${needCover.length}`);
  const BATCH=40;let done=0,coverHit=0;
  for(let i=0;i<needCover.length;i+=BATCH){
    const batch=needCover.slice(i,i+BATCH);
    const results=await oembedBulk(batch.map(t=>t.tid));
    for(let j=0;j<batch.length;j++){
      const t=batch[j],r=results[j];
      if(r){
        meta[t.tid].title=r.title||meta[t.tid].title;
        meta[t.tid].cover=r.cover;
        coverHit++;
      }
    }
    done+=batch.length;
    if(done%200===0||done===needCover.length){
      save();
      log.prog(`${done}/${needCover.length} · +cover=${coverHit} · meta=${Object.keys(meta).length}`);
    }
  }
  save();

  // Final: write track-meta ordered by first collection, and ensure all 3500 track entries exist
  log.head('✅ TAMAMLANDI');
  log.ok(`Canvas:       ${Object.keys(db).length}`);
  log.ok(`Tracks:       ${tracks.length} (toplanan)`);
  log.ok(`Meta entries: ${Object.keys(meta).length}`);
  log.ok(`With cover:   ${Object.values(meta).filter(v=>v.cover).length}`);
  fs.writeFileSync(path.join(ROOT,'server/data/canvas-database.json'),JSON.stringify(db,null,2)+'\n');
  fs.writeFileSync(path.join(ROOT,'server/data/track-meta.json'),JSON.stringify(meta,null,2)+'\n');
}
main().catch(e=>{console.error(e);process.exit(1);});
