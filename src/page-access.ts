import type { Page, Response } from 'playwright';

export class PageAccessBlocked extends Error {}

export async function waitForPageReadiness(page:Page, selector?:string, timeoutMs=8000) {
  if (!selector) return;
  try {
    await page.locator(selector).first().waitFor({state:'visible',timeout:timeoutMs});
  } catch(error) {
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
    throw new PageAccessBlocked('页面就绪等待超时 / Page readiness timed out after '+timeoutMs+' ms · '+selector);
  }
}

/** A sign-in link in a normal business page is not a login wall. Check the actual destination and form. */
export async function checkPageAccess(page:Page,requested:string,response:Response|null){
  const authPath=/(?:^|\/)(?:log-?in|sign-?in|sso|authorize)(?:[/.]|$)/i;
  if(authPath.test(new URL(requested).pathname))return;
  const status=response?.status();
  if(status===403)throw new PageAccessBlocked('访问被拒绝 / HTTP 403. Check the test account and its permissions.');
  const loginMessage='缺少有效登录态 / Login required. In uxqa ui, open the project preview settings and sign in. Configure storageState for CLI runs.';
  if(status===401)throw new PageAccessBlocked(loginMessage);
  const loginForm=page.locator('form:visible').filter({has:page.locator('input[type=password]:visible')})
    .filter({has:page.getByRole('button',{name:/登录|登入|sign\s?in|log\s?in/i})});
  const primarySignIn=()=>loginForm.evaluateAll(forms=>forms.some(form=>{
    if(form.closest('aside,header,nav,footer,[role=complementary]'))return false;
    const main=document.querySelector('main,[role=main]')??document.body;
    if(!main.contains(form))return false;
    const heading=Array.from(main.querySelectorAll('h1,[role=heading][aria-level="1"]')).find(h=>h.getClientRects().length);
    if(heading)return /登录|登入|sign\s?in|log\s?in/i.test(heading.textContent??'');
    // Without a heading, a form alongside independent business controls is insufficient evidence.
    return !Array.from(main.querySelectorAll('button,a[href],input,select,textarea')).some(el=>el.getClientRects().length&&!form.contains(el)&&!el.closest('header,nav,footer'));
  }));
  // A client redirect can replace the document between goto(load) and the form lookup.
  for(let attempt=0;attempt<3;attempt++){
    try{
      if(authPath.test(new URL(page.url()).pathname)||await primarySignIn())throw new PageAccessBlocked(loginMessage);
      return;
    }catch(error){
      if(!(error instanceof Error)||!/execution context was destroyed|cannot find context|frame was detached/i.test(error.message))throw error;
      await page.waitForLoadState('domcontentloaded');
    }
  }
  throw new PageAccessBlocked('页面持续跳转，尚无法检查目标页面。 / Navigation did not settle enough to verify the target page.');
}
