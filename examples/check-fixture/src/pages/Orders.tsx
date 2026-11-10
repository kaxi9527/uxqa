import { Button } from "@/components/ui/button";

export function Orders() {
  return (
    <div className="p-[13px]">
      <div role="tablist">
        <button role="tab" aria-selected>全部订单</button>
      </div>
      <button className="bg-[#1a73e9]">提交订单并且继续</button>
      {/* uxqa-ignore basic/use-library-component -- 第三方嵌入要求原生按钮 */}
      <button>嵌入</button>
      {/* uxqa-ignore basic/use-library-component */}
      <button>没写理由</button>
      <Button>正确用法</Button>
    </div>
  );
}
