# D-AppSupport Helper

To make your daily life easier, once shit start raining from the sky

# Installation

Create a booklet and use the following javascript as URL:

```javascript
javascript:(async()=>{try{const u='https://raw.githubusercontent.com/TheShadeV/appsupp_booklets/main/main_helper.js?t='+Date.now();const r=await fetch(u,{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);const c=await r.text();(0,eval)(c+'\n//# sourceURL=appsupp-main-helper.js')}catch(e){console.error(e);alert('Helper betöltése sikertelen:\n'+e)}})()
```
