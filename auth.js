const jwt = require('jsonwebtoken');
const {get} = require('./db');
const secret = process.env.JWT_SECRET || 'development_only_change_me';

function sign(user) {
  return jwt.sign({id:user.id,email:user.email,name:user.name,organizationId:user.organization_id}, secret, {expiresIn:'12h'});
}
function authenticate(req,res,next) {
  const token = (req.headers.authorization || '').replace(/^Bearer\s+/i,'');
  if (!token) return res.status(401).json({error:'Authentication required'});
  try { req.user = jwt.verify(token,secret); next(); }
  catch { return res.status(401).json({error:'Invalid or expired token'}); }
}
async function tenantAccess(req,res,next) {
  try {
    const tenantId = Number(req.params.tenantId || req.body.tenantId || req.query.tenantId);
    if (!tenantId) return res.status(400).json({error:'tenantId is required'});
    const membership = await get(
      `SELECT m.role,t.organization_id FROM memberships m JOIN tenants t ON t.id=m.tenant_id
       WHERE m.user_id=? AND m.tenant_id=? AND t.organization_id=?`,
      [req.user.id,tenantId,req.user.organizationId]
    );
    if (!membership) return res.status(403).json({error:'You do not have access to this tenant'});
    req.tenantId = tenantId; req.role = membership.role; next();
  } catch(e) { next(e); }
}
function requireAdmin(req,res,next) {
  if (!['org_admin','tenant_admin'].includes(req.role)) return res.status(403).json({error:'Admin role required'});
  next();
}
module.exports = {sign,authenticate,tenantAccess,requireAdmin,secret};
