#!/usr/bin/env python3
"""Validate by default. --run calls the local Gemini endpoint; --shop also matches crops."""
import argparse,base64,datetime,hashlib,io,json,time,urllib.request,urllib.error
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def post(base,path,body):
    request=urllib.request.Request(base+path,data=json.dumps(body).encode(),headers={'Content-Type':'application/json','Origin':base},method='POST')
    with urllib.request.urlopen(request,timeout=90) as response:return json.load(response)

def smoke(case,items):
    e=case['expected']
    if e['empty']:return len(items)==0
    if not items:return e['allow_abstain']
    brands={str(v).lower() for v in e['allowed_brands'] if v is not None}
    if any(item.get('brand') is not None and str(item['brand']).lower() not in brands for item in items):return False
    if any(item.get('model') for item in items) and not e['exact_model_expected']:return False
    return any(item.get('frameIndex') in e['allowed_frame_indexes'] and any(term.lower() in ' '.join(str(item.get(k,'')) for k in ['name','description','searchQuery']).lower() for term in e['category_terms_any']) for item in items)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--run',action='store_true',help='Make real Gemini requests through the running app')
    parser.add_argument('--shop',action='store_true',help='Also run crop-based Shop matching; requires Pillow')
    parser.add_argument('--limit',type=int,default=24)
    parser.add_argument('--base-url',default='http://localhost:3031')
    args=parser.parse_args()
    cases=[json.loads(line) for line in (ROOT/'cases.jsonl').read_text().splitlines() if line.strip()]
    assert len({case['id'] for case in cases})==len(cases)
    for source in json.loads((ROOT/'image-sources.json').read_text()):
        assert hashlib.sha256((ROOT/source['file']).read_bytes()).hexdigest()==source['sha256'],source['file']
    for case in cases:
        assert 1<=len(case['frames'])<=3 and 0<len(case['question'])<=500
        for f in case['frames']:
            data=(ROOT/f['path']).read_bytes()
            assert len(base64.b64encode(data))<=500_000
            assert data.startswith(b'\xff\xd8\xff') if f['mimeType']=='image/jpeg' else data.startswith(b'\x89PNG\r\n\x1a\n')
        assert all(0<=i<len(case['frames']) for i in case['expected']['allowed_frame_indexes'])
    print(f'Validated {len(cases)} cases and 9 input files. No model results are prefilled.')
    if not args.run:
        print('Validation only: no Gemini, Shop, cart, checkout, or payment calls made.')
        return
    if args.limit<1:parser.error('--limit must be positive')
    if args.shop:
        try:from PIL import Image
        except ImportError:parser.error('--shop requires Pillow; install the dependency before running')
    base=args.base_url.rstrip('/')
    if not base.startswith(('http://localhost:','http://127.0.0.1:')):parser.error('Use the local app endpoint')
    run_id=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    folder=ROOT/'runs';folder.mkdir(exist_ok=True)
    output=folder/(run_id+'.jsonl')
    with output.open('w') as saved:
        for index,case in enumerate(cases[:args.limit]):
            if index:time.sleep(max(0,13-(time.monotonic()-started))) # app cap: 5 Gemini requests/minute
            started=time.monotonic()
            frames=[{**f,'data':base64.b64encode((ROOT/f['path']).read_bytes()).decode()} for f in case['frames']]
            record={'case_id':case['id'],'run_id':run_id,'group':case['group'],'measured':True,'shop_grade':None}
            try:
                result=post(base,'/api/shop/ask-stream',{'question':case['question'],'frames':[{k:f[k] for k in ['mimeType','data','timestampSec']} for f in frames]})
                record['detection']=result
                record['automatic_smoke_pass']=smoke(case,result.get('items',[]))
                if args.shop:
                    products=[];seen=set()
                    for item in result.get('items',[])[:2]:
                        frame=frames[item['frameIndex']]
                        image=Image.open(ROOT/frame['path']).convert('RGB');top,left,bottom,right=item['box']
                        box=(max(0,int(left*image.width/1000)),max(0,int(top*image.height/1000)),min(image.width,int(right*image.width/1000)),min(image.height,int(bottom*image.height/1000)))
                        if box[2]<=box[0] or box[3]<=box[1]:raise ValueError('Empty predicted crop')
                        crop=image.crop(box);crop.thumbnail((512,512));buffer=io.BytesIO();crop.save(buffer,format='JPEG',quality=75)
                        match=post(base,'/api/shop/match-stream-item',{'query':item['searchQuery'],'image':{'mimeType':'image/jpeg','data':base64.b64encode(buffer.getvalue()).decode()}})
                        for product in match.get('products',[]):
                            key=(product['shop'],product['variantId'])
                            if key not in seen:seen.add(key);products.append(product)
                    record['shop_top3']=products[:3]
                record['latency_ms']=round((time.monotonic()-started)*1000)
                print(case['id'],'smoke_pass='+str(record['automatic_smoke_pass']))
            except Exception as error:
                record['error_type']=type(error).__name__
                record['automatic_smoke_pass']=None
                print(case['id'],'request failed; no automatic retry')
                saved.write(json.dumps(record)+'\n');saved.flush()
                break
            saved.write(json.dumps(record)+'\n');saved.flush()
    print('Actual results:',output)
if __name__=='__main__':main()
