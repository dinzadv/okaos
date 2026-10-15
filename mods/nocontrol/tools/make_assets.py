from PIL import Image, ImageDraw, ImageFont, ImageFilter, ImageChops
import math, random, os
M="/home/claude/mod/pkg/mods/nocontrol"
random.seed(7)
SS=4
# ---------- arrow.png : flecha facetada con muesca (mascara CSS, apunta a la derecha) ----------
W,H=532,443
im=Image.new("L",(W*SS,H*SS),0); d=ImageDraw.Draw(im)
def P(pts): return [(x*SS,y*SS) for x,y in pts]
# chevron solido con muesca trasera y pequeno escalon glitch en la cola
d.polygon(P([(30,60),(285,60),(505,221),(285,383),(30,383),(165,221)]),fill=255)
d.rectangle(P([(95,150),(150,178)]),fill=0)
# bordes redondeados
im=im.filter(ImageFilter.GaussianBlur(5*SS/2)).point(lambda v:255 if v>128 else 0)
im=im.resize((W,H),Image.LANCZOS)
out=Image.new("RGBA",(W,H),(255,255,255,0)); out.putalpha(im); out.save(f"{M}/img/assets/arrow.png")

# ---------- bom.png : bomba glitch roja ----------
W,H=512,538
big=Image.new("RGBA",(W*2,H*2),(0,0,0,0)); g=ImageDraw.Draw(big)
cx,cy,r=512,640,330
for i in range(40,0,-1):  # halo
    a=int(3*(41-i)/4)
    g.ellipse((cx-r-i*4,cy-r-i*4,cx+r+i*4,cy+r+i*4),fill=(255,30,60,a))
g.ellipse((cx-r,cy-r,cx+r,cy+r),fill=(22,12,28,255),outline=(255,42,95,255),width=16)
g.arc((cx-r+50,cy-r+50,cx+r-50,cy+r-50),200,250,fill=(255,255,255,110),width=22)
g.rectangle((cx-70,cy-r-70,cx+70,cy-r+30),fill=(60,40,70,255),outline=(255,42,95,255),width=10)
g.line([(cx,cy-r-70),(cx+60,cy-r-150),(cx+20,cy-r-230)],fill=(255,200,120,255),width=16)
for k,(dx,dy,rr,col) in enumerate([(20,-r-240,46,(255,235,120,255)),(20,-r-240,24,(255,255,255,255))]):
    g.ellipse((cx+dx-rr,cy+dy-rr,cx+dx+rr,cy+dy+rr),fill=col)
# franjas glitch
for _ in range(7):
    y=random.randint(cy-r+60,cy+r-60); h=random.randint(14,30); s=random.randint(-40,40)
    band=big.crop((cx-r,y,cx+r,y+h)); big.paste(band,(cx-r+s,y),band)
g.line([(cx-170,cy+40),(cx-90,cy-30),(cx-10,cy+50),(cx+70,cy-30),(cx+170,cy+40)],fill=(255,42,95,255),width=22)
big.resize((W,H),Image.LANCZOS).save(f"{M}/img/assets/bom.png")

# ---------- fondo.jpg : portada / fondo (1280x720) ----------
W,H=1280,720
bg=Image.new("RGB",(W,H),(8,6,18)); px=bg.load()
for y in range(H):
    for x in range(0,W):
        t=x/W
        # diagonal Teto (rojo) -> Miku (turquesa)
        k=(x*0.55+y*0.45)/(W*0.55+H*0.45)
        r=int(8+ (255*0.55*(1-k)**1.6)); gcol=int(6+(229*0.55*k**1.6)); b=int(18+(212*0.55*k**1.6)+(70*(1-k)**3))
        px[x,y]=(min(255,r),min(255,gcol),min(255,b))
lay=Image.new("RGBA",(W,H),(0,0,0,0)); d=ImageDraw.Draw(lay)
# barras ecualizador
for i in range(64):
    x=i*20+4; hh=int(60+abs(math.sin(i*0.37)*220)+random.randint(0,90))
    col=(255,42,95,120) if i<32 else (0,229,212,120)
    d.rectangle((x,H-hh,x+12,H),fill=col)
# lineas diagonales
for i in range(-10,24):
    d.line([(i*70,0),(i*70+380,H)],fill=(255,255,255,14),width=2)
lay=lay.filter(ImageFilter.GaussianBlur(1))
bg=Image.alpha_composite(bg.convert("RGBA"),lay)
_t=bg.convert("RGB")
for _ in range(9):
    y=random.choice([random.randint(20,200),random.randint(470,700)]); h=random.randint(6,18); sft=random.randint(-60,60)
    _t.paste(_t.crop((0,y,W,y+h)),(sft,y))
bg=_t.convert("RGBA")
# vineta
vg=Image.new("L",(W,H),0); vd=ImageDraw.Draw(vg); vd.ellipse((-W*0.25,-H*0.35,W*1.25,H*1.35),fill=255)
vg=vg.filter(ImageFilter.GaussianBlur(120))
dark=Image.new("RGBA",(W,H),(0,0,0,255)); bg=Image.composite(bg,dark,vg)
F="/usr/share/fonts/opentype/noto/NotoSansCJK-Black.ttc"
def txt(draw,xy,s,font,fill,anchor="mm"): draw.text(xy,s,font=font,fill=fill,anchor=anchor)
ft=ImageFont.truetype(F,150); fs=ImageFont.truetype(F,44); fm=ImageFont.truetype(F,30)
title=Image.new("RGBA",(W,H),(0,0,0,0)); td=ImageDraw.Draw(title)
for off,col in [((-7,0),(255,42,95,255)),((7,0),(0,229,212,255))]:
    txt(td,(W//2+off[0],H//2-40+off[1]),"NO CONTROL",ft,col)
glow=title.filter(ImageFilter.GaussianBlur(14)); bg=Image.alpha_composite(bg,glow); bg=Image.alpha_composite(bg,title)
td2=ImageDraw.Draw(bg); txt(td2,(W//2,H//2-40),"NO CONTROL",ft,(255,255,255,255))
txt(td2,(W//2,H//2+75),"重音テト  ×  初音ミク",fs,(255,255,255,235))
txt(td2,(W//2,H//2+135),"Kasane Teto  ·  Hatsune Miku   —   160 BPM",fm,(255,255,255,170))
bgr=bg.convert("RGB")
bgr.save(f"{M}/assets/fondo.jpg",quality=88)
print("assets ok")
