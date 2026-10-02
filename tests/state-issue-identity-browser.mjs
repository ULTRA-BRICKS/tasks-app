import assert from 'node:assert/strict';
import {chromium,webkit} from '@playwright/test';
const origin=process.argv[2]??'http://127.0.0.1:6937';
assert.equal(new URL(origin).hostname,'127.0.0.1');
for(const [name,engine] of [['chromium',chromium],['webkit',webkit]]){
 const browser=await engine.launch();
 try{
  const page=await browser.newPage(),errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/**',route=>route.fulfill({status:200,contentType:'application/json',body:'[]'}));
  await page.goto(origin+'/tests/fixtures/issue-draft-lifecycle/index.html');
  const title=page.getByRole('textbox',{name:'Title',exact:true});
  await title.fill('First private draft');
  await page.locator('#second').click();
  await page.waitForTimeout(30);
  assert.equal(await title.inputValue(),'','A new identity must not inherit the previous controller');
  await title.fill('Second private draft');
  await page.locator('#first').click();
  await page.waitForTimeout(30);
  assert.equal(await title.inputValue(),'First private draft');
  await page.locator('#second').click();
  await page.waitForTimeout(30);
  assert.equal(await title.inputValue(),'Second private draft');
  assert.deepEqual(errors,[]);
  console.log('PASS',name,'actual new-issue page preserves separate drafts when account changes on the same route');
 }finally{await browser.close();}
}
