import { test } from '@playwright/test';
import { domTarget, loadBrowserBaseline, regionTarget, saveBrowserBaseline } from 'slicewright/browser';
import { expect } from 'slicewright/playwright';

const variants=[
  {name:'wide-en',width:900,locale:'en',scale:1},
  {name:'narrow-ko',width:360,locale:'ko',scale:1},
  {name:'wide-en-large',width:900,locale:'en',scale:2},
  {name:'narrow-ko-large',width:360,locale:'ko',scale:2},
];
for(const renderer of ['dom','canvas'])for(const variant of variants){
  test.describe(`${renderer} ${variant.name}`,()=>{
    test.use({viewport:{width:variant.width,height:1200},locale:variant.locale==='ko'?'ko-KR':'en-US'});
    test('approved idle and collected letter',async({page,browser},info)=>{
      const query=new URLSearchParams({renderer,locale:variant.locale,scale:String(variant.scale)});
      if(process.env.SLICEWRIGHT_EXAMPLE_FAULT)query.set('fault',process.env.SLICEWRIGHT_EXAMPLE_FAULT);
      await page.goto(`/?${query}`);
      await page.evaluate(()=>window.letterPanel.ready);
      const panel=renderer==='dom'?domTarget(page,{
        root:page.locator('#panel'),contentBox:page.locator('#content'),
        content:Object.fromEntries(['title','body','action','status'].map(name=>[name,page.locator(`#${name}`)])),
      }):regionTarget(page,{measure:()=>page.evaluate(()=>window.letterPanel.measure())});
      const action=renderer==='dom'?domTarget(page,{root:page.locator('#action')}):
        regionTarget(page,{measure:()=>page.evaluate(()=>window.letterPanel.measure(true))});
      // Caller-owned environment keys include the assumptions this example controls.
      // Bump system-fonts-v1 when changing the machine image/fonts used for approval.
      const environment=[process.platform,info.project.name,browser.version(),variant.width,'1200','dpr1',variant.locale,`text${variant.scale}`,'system-fonts-v1'].join('|');
      async function verify(state){
        await expect(panel).toBeStableUI({duration:200});
        const expectedStatus=variant.locale==='ko'?(state==='idle'?'새로운 편지가 기다려요.':'편지를 받았어요!'):
          (state==='idle'?'A new letter is waiting.':'Letter collected!');
        await expect(page.getByRole('button')).toHaveAccessibleName(variant.locale==='ko'?'편지 받기':'Take letter');
        await expect(page.getByRole('status')).toHaveText(expectedStatus);
        const checks={contentFits:true,text:{status:expectedStatus}};
        const name=`${renderer}-${variant.name}-${state}.slicewright.json`;
        if(process.env.SLICEWRIGHT_EXAMPLE_APPROVE==='1'){
          // The separate approve command is the only baseline-writing path.
          await expect(panel).toMatchUI(checks);
          await saveBrowserBaseline(info.snapshotPath(name),await panel.capture(),{approved:true,environment});
        }
        if(process.platform==='win32'&&info.project.name==='firefox'){
          // Reviewed native glyph variation: only approved text rectangles get a budget.
          // Keep geometry, alpha and every pixel outside these rectangles exact.
          const reference=await loadBrowserBaseline(info.snapshotPath(name),{environment});
          const actual=await panel.capture();
          expect(actual.measurement).toEqual(reference.measurement);
          expect(actual.clip).toEqual(reference.clip);
          checks.pixelRegions=[{
            name:'approved-native-glyphs',
            bounds:Object.values(reference.measurement.content).flatMap(content=>content.textBounds??[])
              .filter(bounds=>bounds.width>0&&bounds.height>0)
              .map(bounds=>({...bounds,x:bounds.x-reference.clip.x,y:bounds.y-reference.clip.y})),
            pixels:{mean:0.01,p99:0,max:renderer==='dom'?40:32},
          }];
        }
        await expect(panel).toMatchUIBaseline(name,{environment,checks});
      }
      await verify('idle');
      await action.click();
      await expect.poll(()=>page.evaluate(()=>window.letterPanel.state().count)).toBe(1);
      await verify('collected');
    });
  });
}
