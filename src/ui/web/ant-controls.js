// Keep React-owned controls inside the console's existing DOM and form lifecycle.
class AntControl extends HTMLElement {
  connectedCallback() {
    this.root = ReactDOM.createRoot(this);
    ReactDOM.flushSync(() => this.root.render(React.createElement(antd.ConfigProvider, {
      csp: { nonce: document.getElementById('ant-style').nonce },
      theme: { zeroRuntime: true, hashed: false, cssVar: { key: 'uxqa-ant' } },
      wave: { disabled: true },
      button: { autoInsertSpace: false },
    }, this.control)));
  }
  disconnectedCallback() {
    this.root.unmount();
  }
}
customElements.define('uxqa-ant-control', AntControl);

function antControl(component, props, child) {
  const host = document.createElement('uxqa-ant-control');
  host.control = React.createElement(component, props, child);
  return host;
}

function antButton(label, onClick, props = {}) {
  const appearance = props.type ? {} : { variant: 'filled', color: 'default' };
  return antControl(antd.Button, { htmlType: 'button', onClick, ...appearance, ...props }, label);
}
