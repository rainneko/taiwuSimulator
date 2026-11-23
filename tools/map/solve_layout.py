# 省片拼图求解：先按地理先验摆位，再用 FFT 互相关在窗口内找「边缘接触最多、重叠最少」的位置。
# 用法：python3 tools/map/solve_layout.py out.png 60 50  → 打印各片中心（原图像素），写入 src/scenes/world/worldData.ts 的 RAW。
import numpy as np, sys, json
from PIL import Image
D='assets/map_terrain/map_terrain/worldmap_overlays/'
K=4; W=H=1024
def dil(a,n):
  for _ in range(n):
    b=a.copy(); b[1:]|=a[:-1]; b[:-1]|=a[1:]; b[:,1:]|=a[:,:-1]; b[:,:-1]|=a[:,1:]; a=b
  return a
masks={};edges={}
for n in range(15):
  a=np.array(Image.open(D+f'MapPlace{n}.png').convert('RGBA'))[:,:,3]
  m=np.array(Image.fromarray(a).resize((a.shape[1]//K,a.shape[0]//K),Image.BILINEAR))>110
  e=m & dil(~m,1)
  e[:2,:]=False; e[-2:,:]=False; e[:,:2]=False; e[:,-2:]=False   # 贴着包围盒的直边 = 地图外框，不参与拼合
  masks[n]=m; edges[n]=e
F=np.fft.rfft2; I=np.fft.irfft2
def corr(canvasF, small):
  P=np.zeros((H,W)); P[:small.shape[0],:small.shape[1]]=small
  return I(canvasF*np.conj(F(P)),s=(H,W))   # out[y,x] = sum canvas[y+i,x+j]*small[i,j]
RAW=[(10,330,760),(9,1960,170),(4,1040,350),(0,1500,430),(6,1880,560),(3,1080,790),(12,1560,880),(14,1930,900),(1,610,1300),(7,1090,1170),(13,1960,1170),(11,470,1720),(2,1000,1700),(5,1470,1640),(8,1830,1470)]
PACK,CX,CY=0.84,1150,975; OFF=150
prior={n:((CX+(x-CX)*PACK)/K+OFF,(CY+(y-CY)*PACK)/K+OFF) for n,x,y in RAW}
R=int(sys.argv[2]) if len(sys.argv)>2 else 60
C=np.zeros((H,W),bool); pos={}
seed=3; m=masks[seed]; x,y=int(prior[seed][0]-m.shape[1]/2),int(prior[seed][1]-m.shape[0]/2)
pos[seed]=(x,y); C[y:y+m.shape[0],x:x+m.shape[1]]=m
YY,XX=np.mgrid[0:H,0:W]
while len(pos)<15:
  near=dil(C,2)&~C; fN=F(near.astype(float)); fC=F(C.astype(float))
  best=None
  for n in masks:
    if n in pos: continue
    h,w=masks[n].shape
    # 只考虑离已放片最近的候选（先放与已有片相邻的）
    d=min(np.hypot(prior[n][0]-prior[k][0],prior[n][1]-prior[k][1]) for k in pos)
    s=corr(fN,edges[n].astype(float)) - 25*corr(fC,masks[n].astype(float))
    px,py=prior[n][0]-w/2,prior[n][1]-h/2
    s[(np.abs(XX-px)>R)|(np.abs(YY-py)>R)]=-1e9
    k=np.argmax(s); y,x=divmod(k,W); v=s[y,x]/edges[n].sum()
    key=v - d/2000
    if best is None or key>best[0]: best=(key,n,x,y,v)
  _,n,x,y,v=best; pos[n]=(x,y); h,w=masks[n].shape; C[y:y+h,x:x+w]|=masks[n]
  print('place',n,'score %.2f'%v,file=sys.stderr)
R2=int(sys.argv[3]) if len(sys.argv)>3 else 40
def compose(skip):
  c=np.zeros((H,W),bool)
  for k,(x,y) in pos.items():
    if k!=skip: h,w=masks[k].shape; c[y:y+h,x:x+w]|=masks[k]
  return c
for it in range(4):
  changed=0
  for n in list(pos):
    c=compose(n); near=dil(c,2)&~c
    s2=corr(F(near.astype(float)),edges[n].astype(float)) - 25*corr(F(c.astype(float)),masks[n].astype(float))
    x0,y0=pos[n]; s2[(np.abs(XX-x0)>R2)|(np.abs(YY-y0)>R2)]=-1e9
    k=np.argmax(s2); y,x=divmod(k,W)
    if (x,y)!=(x0,y0): pos[n]=(x,y); changed+=1
  print('refine',it,changed,file=sys.stderr)
  if not changed: break
for it in range(3):
  for n in [4,10,9,11,8,1,13]:
    c=compose(n); near=dil(c,7)&~c
    s2=corr(F(near.astype(float)),edges[n].astype(float)) - 4*corr(F(c.astype(float)),masks[n].astype(float))
    x0,y0=pos[n]; s2[(np.abs(XX-x0)>30)|(np.abs(YY-y0)>30)]=-1e9
    k=np.argmax(s2); y,x=divmod(k,W); pos[n]=(x,y)
for n in pos:
  c=compose(n); near=dil(c,2)&~c; x,y=pos[n]; h,w=masks[n].shape
  print('final',n,'%.2f'%((edges[n]&near[y:y+h,x:x+w]).sum()/edges[n].sum()),'ovl',(masks[n]&c[y:y+h,x:x+w]).sum(),file=sys.stderr)
xs=[p[0] for p in pos.values()]; ys=[p[1] for p in pos.values()]
x0,y0=min(xs),min(ys)
out={n:((x-x0+masks[n].shape[1]/2)*K,(y-y0+masks[n].shape[0]/2)*K) for n,(x,y) in pos.items()}
print(json.dumps(out))
mx=max(out[n][0]+masks[n].shape[1]*K/2 for n in out); my=max(out[n][1]+masks[n].shape[0]*K/2 for n in out)
img=Image.new('RGBA',(int(mx/2)+10,int(my/2)+10),(200,180,150,255))
from PIL import ImageDraw
for n,(cx,cy) in out.items():
  p=Image.open(D+f'MapPlace{n}.png').convert('RGBA'); p=p.resize((p.width//2,p.height//2))
  img.alpha_composite(p,(int(cx/2-p.width/2),int(cy/2-p.height/2)))
  ImageDraw.Draw(img).text((cx/2,cy/2),str(n),fill=(255,0,0,255))
img.save(sys.argv[1])
