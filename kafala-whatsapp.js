'use strict';

function transferInquiryDetails(ad) {
  return [
    ['المهنة', ad.prof],
    ['الإمارة', ad.emirate],
    ['العمر', ad.age == null ? '' : ad.age + ' سنة'],
    ['الخبرة', ad.exp == null ? '' : ad.exp + ' سنوات'],
    ['الراتب الشهري', ad.salary == null ? '' : Number(ad.salary).toLocaleString('en-AE') + ' درهم'],
    ['الجنسية', ad.nationality],
    ['المهارات', ad.skills.join('، ')]
  ].filter(([,value]) => value);
}

function transferWhatsAppUrl(ad, number) {
  const link = new URL('kafala.html', location.href);
  link.hash = 'ad=' + ad.id;
  const lines = transferInquiryDetails(ad).map(([label,value]) => label + ' • ' + value);
  const message = [
    'السلام عليكم، أود الاستفسار عن هذا العامل لنقل الكفالة. هل الإعلان ما زال متاحًا؟',
    '', 'ساهل‑2 | ' + ad.name, ...lines, '', 'صورة العامل وتفاصيل الإعلان', link.href
  ].join('\n');
  const whatsapp = new URL('https://wa.me/' + number);
  whatsapp.searchParams.set('text',message);
  return whatsapp.href;
}

async function renderTransferInquiryCard(ad) {
  async function loadImage(src) {
    if (!src) return null;
    const image = new Image();
    image.src = src;
    try { await image.decode(); return image; }
    catch { return null; }
  }
  const [photo, logo] = await Promise.all([loadImage(ad.photo),loadImage('saahl-logo.png')]);
  const canvas = document.createElement('canvas');
  canvas.width = 800;
  const details = transferInquiryDetails(ad);
  canvas.height = (photo ? 495 : 186) + details.length*55 + 126;
  const ctx = canvas.getContext('2d');
  const text = (value,x,y,size,color,weight=400,width=700) => {
    ctx.font = weight + ' ' + size + 'px Arial, sans-serif';
    ctx.fillStyle = color;
    ctx.fillText(value,x,y,width);
  };

  ctx.fillStyle = '#f8f4eb';
  ctx.fillRect(0,0,canvas.width,canvas.height);
  ctx.fillStyle = '#151725';
  ctx.fillRect(0,0,800,152);
  ctx.fillStyle = '#c9a85d';
  ctx.fillRect(0,149,800,3);
  ctx.direction = 'rtl';
  ctx.textAlign = 'right';
  text('ساهل ٢  |  نقل الكفالة',750,53,25,'#ecd895',700);
  text('استفسار عن عامل',750,111,42,'#ffffff',800);
  if (logo) {
    const scale = 77/Math.max(logo.naturalWidth,logo.naturalHeight);
    ctx.drawImage(logo,42,38,logo.naturalWidth*scale,logo.naturalHeight*scale);
  }

  let y = 186;
  if (photo) {
    const scale = Math.min(692/photo.naturalWidth,286/photo.naturalHeight);
    const width = photo.naturalWidth*scale, height = photo.naturalHeight*scale;
    ctx.fillStyle = '#ede7db';
    ctx.fillRect(48,174,704,296);
    ctx.drawImage(photo,400-width/2,322-height/2,width,height);
    y = 495;
  }
  for (const [label,value] of details) {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(48,y,704,48);
    text(label,733,y+32,22,'#725628',700,180);
    ctx.textAlign = 'left';
    text(value,69,y+32,23,'#151725',700,445);
    ctx.textAlign = 'right';
    y += 55;
  }
  text(ad.name,750,y+46,24,'#725628',700);
  text('هل ما زال الإعلان متاحًا للتواصل؟',750,y+89,30,'#151725',700);

  return new Promise((resolve,reject) => canvas.toBlob(
    blob => blob ? resolve(blob) : reject(new Error('Card unavailable')), 'image/png'
  ));
}

async function prepareTransferInquiryCard(ad, destination, isCurrent) {
  const card = destination.then(async number => {
    if (!number || !isCurrent()) return null;
    const blob = await renderTransferInquiryCard(ad);
    return isCurrent() ? blob : null;
  }).catch(() => null);

  // The clipboard request must start within the visitor's click, before the lookup finishes.
  if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
    try {
      const image = card.then(blob => {
        if (!blob || !isCurrent()) throw new Error('Card unavailable');
        return blob;
      });
      // The browser may reject the write before consuming the image promise.
      image.catch(() => {});
      await navigator.clipboard.write([new ClipboardItem({'image/png':image})]);
      return;
    } catch {
      // Use the original card as a downloadable attachment when clipboard access fails.
    }
  }
  const blob = await card;
  if (!blob || !isCurrent()) return;
  try {
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.href = url;
    link.download = 'saahl-inquiry-' + ad.id.slice(0,8) + '.png';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url),30000);
  } catch {
    // The text and direct listing link still work if the browser blocks the attachment.
  }
}
