## Default Permission

Allows the app to open the system sign-in sheet with `authenticate` and, on
Android, to ask Google Play services for a Google access token with
`google_authorize`.

#### This default permission set includes the following:

- `allow-authenticate`
- `allow-google-authorize`

## Permission Table

<table>
<tr>
<th>Identifier</th>
<th>Description</th>
</tr>


<tr>
<td>

`lolly-auth:allow-authenticate`

</td>
<td>

Enables the authenticate command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`lolly-auth:deny-authenticate`

</td>
<td>

Denies the authenticate command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`lolly-auth:allow-google-authorize`

</td>
<td>

Enables the google_authorize command without any pre-configured scope.

</td>
</tr>

<tr>
<td>

`lolly-auth:deny-google-authorize`

</td>
<td>

Denies the google_authorize command without any pre-configured scope.

</td>
</tr>
</table>
